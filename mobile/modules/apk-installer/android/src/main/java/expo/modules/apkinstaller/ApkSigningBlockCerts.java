package expo.modules.apkinstaller;

import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/**
 * Reads the current X.509 signing certificate from an APK Signing Block (scheme v2 / v3 / v3.1).
 *
 * {@code PackageManager.getPackageArchiveInfo} on older Android (including API 28) does not
 * return signatures for v2-only archives, so the in-app updater cannot rely on it.
 * This parser uses only the JDK so the same class can run on a host and on minSdk 24.
 *
 * A present block that is truncated, empty, or malformed is unreadable: never a partial
 * cert list, and never a v1 / {@code GET_SIGNATURES} fallback. v1 is only for archives
 * with no APK Signing Block at all.
 */
public final class ApkSigningBlockCerts {
  static final int EOCD_SIG = 0x06054b50;
  static final int ZIP64_LOCATOR_SIG = 0x07064b50;
  static final int ZIP64_EOCD_SIG = 0x06064b50;
  static final int EOCD_MIN = 22;
  static final int MAX_ZIP_COMMENT = 0xffff;
  static final long ZIP64_MAGIC = 0xffffffffL;

  static final int V2_BLOCK_ID = 0x7109871a;
  static final int V3_BLOCK_ID = 0xf05368c0;
  static final int V31_BLOCK_ID = 0x1b93ad61;
  static final byte[] SIG_BLOCK_MAGIC =
      "APK Sig Block 42".getBytes(StandardCharsets.US_ASCII);

  private static final char[] HEX = "0123456789abcdef".toCharArray();

  private ApkSigningBlockCerts() {}

  public static final class Read {
    public static final int OK = 0;
    public static final int ABSENT = 1;
    public static final int UNREADABLE = 2;

    public final int status;
    public final String hex;

    private Read(int status, String hex) {
      this.status = status;
      this.hex = hex;
    }

    public static Read ok(String hex) {
      return new Read(OK, hex);
    }

    public static Read absent() {
      return new Read(ABSENT, null);
    }

    public static Read unreadable() {
      return new Read(UNREADABLE, null);
    }

    public boolean isOk() {
      return status == OK;
    }

    public boolean isAbsent() {
      return status == ABSENT;
    }

    public boolean isUnreadable() {
      return status == UNREADABLE;
    }
  }

  public static Read read(File apk) {
    if (apk == null || !apk.isFile()) {
      return Read.unreadable();
    }
    try (RandomAccessFile raf = new RandomAccessFile(apk, "r")) {
      return read(raf);
    } catch (IOException e) {
      return Read.unreadable();
    }
  }

  public static String sha256Hex(byte[] certDer) {
    try {
      return hex(MessageDigest.getInstance("SHA-256").digest(certDer));
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException("SHA-256 is required to read signing certificates.", e);
    }
  }

  public static String hex(byte[] bytes) {
    char[] out = new char[bytes.length * 2];
    for (int i = 0; i < bytes.length; i++) {
      int v = bytes[i] & 0xff;
      out[i * 2] = HEX[v >>> 4];
      out[i * 2 + 1] = HEX[v & 0x0f];
    }
    return new String(out);
  }

  static Read read(RandomAccessFile raf) throws IOException {
    long cdOffset = centralDirectoryOffset(raf);
    if (cdOffset < 0) {
      return Read.unreadable();
    }
    if (cdOffset < 24) {
      return Read.absent();
    }
    byte[] footer = new byte[24];
    raf.seek(cdOffset - 24);
    raf.readFully(footer);
    if (!hasMagic(footer)) {
      return Read.absent();
    }
    try {
      ByteBuffer pairs = signingBlockPairs(raf, cdOffset, footer);
      return certFromPairs(pairs);
    } catch (IOException e) {
      return Read.unreadable();
    }
  }

  private static boolean hasMagic(byte[] footer) {
    if (footer.length < 24) {
      return false;
    }
    for (int i = 0; i < SIG_BLOCK_MAGIC.length; i++) {
      if (footer[8 + i] != SIG_BLOCK_MAGIC[i]) {
        return false;
      }
    }
    return true;
  }

  private static Read certFromPairs(ByteBuffer pairs) throws IOException {
    String hex = null;
    while (pairs.hasRemaining()) {
      if (pairs.remaining() < 8) {
        throw new IOException("truncated pair");
      }
      long pairLen = pairs.getLong();
      if (pairLen < 4 || pairLen > pairs.remaining()) {
        throw new IOException("invalid pair length");
      }
      int id = pairs.getInt();
      int valueLen = (int) (pairLen - 4);
      byte[] value = new byte[valueLen];
      pairs.get(value);
      if (id == V2_BLOCK_ID || id == V3_BLOCK_ID || id == V31_BLOCK_ID) {
        String next = firstCertOfSingleSigner(value);
        if (hex == null) {
          hex = next;
        } else if (!hex.equals(next)) {
          throw new IOException("conflicting signing schemes");
        }
      }
    }
    if (hex == null) {
      throw new IOException("signing block has no v2/v3 signer");
    }
    return Read.ok(hex);
  }

  private static String firstCertOfSingleSigner(byte[] schemeBlock) throws IOException {
    ByteBuffer block = ByteBuffer.wrap(schemeBlock).order(ByteOrder.LITTLE_ENDIAN);
    ByteBuffer signers = lengthPrefixed(block);
    if (block.hasRemaining()) {
      throw new IOException("extra bytes after signers");
    }
    if (!signers.hasRemaining()) {
      throw new IOException("no signers");
    }
    ByteBuffer signer = lengthPrefixed(signers);
    if (signers.hasRemaining()) {
      throw new IOException("second signer");
    }
    ByteBuffer signedData = lengthPrefixed(signer);
    lengthPrefixed(signedData); // digests
    ByteBuffer certificates = lengthPrefixed(signedData);
    if (!certificates.hasRemaining()) {
      throw new IOException("no certificates");
    }
    byte[] first = lengthPrefixedBytes(certificates);
    if (first.length == 0) {
      throw new IOException("empty certificate");
    }
    while (certificates.hasRemaining()) {
      lengthPrefixedBytes(certificates);
    }
    return sha256Hex(first);
  }

  private static ByteBuffer signingBlockPairs(RandomAccessFile raf, long cdOffset, byte[] footer)
      throws IOException {
    long size = u64(footer, 0);
    if (size < 24 || size > cdOffset - 8) {
      throw new IOException("invalid signing block size");
    }
    long blockStart = cdOffset - size - 8;
    if (blockStart < 0) {
      throw new IOException("signing block underflow");
    }
    byte[] headerSize = new byte[8];
    raf.seek(blockStart);
    raf.readFully(headerSize);
    if (u64(headerSize, 0) != size) {
      throw new IOException("signing block size mismatch");
    }
    long pairsLen = size - 24;
    if (pairsLen < 0 || pairsLen > Integer.MAX_VALUE) {
      throw new IOException("invalid pairs length");
    }
    byte[] pairs = new byte[(int) pairsLen];
    raf.seek(blockStart + 8);
    raf.readFully(pairs);
    return ByteBuffer.wrap(pairs).order(ByteOrder.LITTLE_ENDIAN);
  }

  static long centralDirectoryOffset(RandomAccessFile raf) throws IOException {
    long fileSize = raf.length();
    if (fileSize < EOCD_MIN) {
      return -1;
    }
    int maxTail = (int) Math.min(fileSize, (long) EOCD_MIN + MAX_ZIP_COMMENT);
    byte[] tail = new byte[maxTail];
    raf.seek(fileSize - maxTail);
    raf.readFully(tail);
    for (int comment = 0; comment <= MAX_ZIP_COMMENT; comment++) {
      int eocd = tail.length - EOCD_MIN - comment;
      if (eocd < 0) {
        break;
      }
      if (u32(tail, eocd) != (EOCD_SIG & 0xffffffffL)) {
        continue;
      }
      if (u16(tail, eocd + 20) != comment) {
        continue;
      }
      long cdOffset = u32(tail, eocd + 16);
      if (cdOffset == ZIP64_MAGIC) {
        return zip64CentralDirectoryOffset(raf, fileSize - maxTail + eocd);
      }
      if (cdOffset > fileSize) {
        return -1;
      }
      return cdOffset;
    }
    return -1;
  }

  private static long zip64CentralDirectoryOffset(RandomAccessFile raf, long eocdOffset)
      throws IOException {
    if (eocdOffset < 20) {
      return -1;
    }
    byte[] locator = new byte[20];
    raf.seek(eocdOffset - 20);
    raf.readFully(locator);
    if (u32(locator, 0) != (ZIP64_LOCATOR_SIG & 0xffffffffL)) {
      return -1;
    }
    long zip64Eocd = u64(locator, 8);
    if (zip64Eocd < 0 || zip64Eocd + 56 > raf.length()) {
      return -1;
    }
    byte[] record = new byte[56];
    raf.seek(zip64Eocd);
    raf.readFully(record);
    if (u32(record, 0) != (ZIP64_EOCD_SIG & 0xffffffffL)) {
      return -1;
    }
    return u64(record, 48);
  }

  private static ByteBuffer lengthPrefixed(ByteBuffer buf) throws IOException {
    if (buf.remaining() < 4) {
      throw new IOException("truncated length prefix");
    }
    int len = buf.getInt();
    if (len < 0 || len > buf.remaining()) {
      throw new IOException("invalid length prefix");
    }
    ByteBuffer slice = buf.slice().order(ByteOrder.LITTLE_ENDIAN);
    slice.limit(len);
    buf.position(buf.position() + len);
    return slice;
  }

  private static byte[] lengthPrefixedBytes(ByteBuffer buf) throws IOException {
    ByteBuffer slice = lengthPrefixed(buf);
    byte[] out = new byte[slice.remaining()];
    slice.get(out);
    return out;
  }

  private static int u16(byte[] b, int off) {
    return (b[off] & 0xff) | ((b[off + 1] & 0xff) << 8);
  }

  private static long u32(byte[] b, int off) {
    return (u16(b, off) | ((long) u16(b, off + 2) << 16)) & 0xffffffffL;
  }

  private static long u64(byte[] b, int off) {
    return u32(b, off) | (u32(b, off + 4) << 32);
  }

  public static void main(String[] args) {
    if (args.length != 1) {
      System.err.println("usage: ApkSigningBlockCerts <apk>");
      System.exit(2);
    }
    Read result = read(new File(args[0]));
    if (result.isOk()) {
      System.out.println(result.hex);
      return;
    }
    System.err.println(result.isAbsent() ? "absent" : "unreadable");
    System.exit(1);
  }
}
