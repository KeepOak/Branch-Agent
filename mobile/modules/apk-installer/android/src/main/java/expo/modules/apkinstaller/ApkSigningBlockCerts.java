package expo.modules.apkinstaller;

import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Reads X.509 signing certificates from an APK Signing Block (scheme v2 / v3 / v3.1).
 *
 * {@code PackageManager.getPackageArchiveInfo} on older Android (including API 28) does not
 * return signatures for v2-only archives, so the in-app updater cannot rely on it.
 * This parser uses only the JDK so the same class can run on a host and on minSdk 24.
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

  /** SHA-256 fingerprints (lowercase hex) of every v2/v3/v3.1 certificate, first-seen order. */
  public static List<String> sha256Hexes(File apk) {
    if (apk == null || !apk.isFile()) {
      return Collections.emptyList();
    }
    try (RandomAccessFile raf = new RandomAccessFile(apk, "r")) {
      return sha256Hexes(raf);
    } catch (IOException e) {
      return Collections.emptyList();
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

  static List<String> sha256Hexes(RandomAccessFile raf) throws IOException {
    long cdOffset = centralDirectoryOffset(raf);
    if (cdOffset < 0) {
      return Collections.emptyList();
    }
    ByteBuffer pairs = signingBlockPairs(raf, cdOffset);
    if (pairs == null) {
      return Collections.emptyList();
    }
    Set<String> unique = new LinkedHashSet<String>();
    while (pairs.remaining() >= 8) {
      long pairLen = pairs.getLong();
      if (pairLen < 4 || pairLen > pairs.remaining()) {
        break;
      }
      int id = pairs.getInt();
      int valueLen = (int) (pairLen - 4);
      byte[] value = new byte[valueLen];
      pairs.get(value);
      if (id == V2_BLOCK_ID || id == V3_BLOCK_ID || id == V31_BLOCK_ID) {
        addSchemeCerts(value, unique);
      }
    }
    return new ArrayList<String>(unique);
  }

  private static void addSchemeCerts(byte[] schemeBlock, Set<String> unique) {
    try {
      ByteBuffer block = ByteBuffer.wrap(schemeBlock).order(ByteOrder.LITTLE_ENDIAN);
      ByteBuffer signers = lengthPrefixed(block);
      while (signers.hasRemaining()) {
        ByteBuffer signer = lengthPrefixed(signers);
        ByteBuffer signedData = lengthPrefixed(signer);
        lengthPrefixed(signedData); // digests
        ByteBuffer certificates = lengthPrefixed(signedData);
        while (certificates.hasRemaining()) {
          byte[] encoded = lengthPrefixedBytes(certificates);
          if (encoded.length > 0) {
            unique.add(sha256Hex(encoded));
          }
        }
      }
    } catch (IOException ignored) {
      // One malformed scheme must not hide certificates in another scheme.
    }
  }

  private static ByteBuffer signingBlockPairs(RandomAccessFile raf, long cdOffset)
      throws IOException {
    if (cdOffset < 24) {
      return null;
    }
    byte[] footer = new byte[24];
    raf.seek(cdOffset - 24);
    raf.readFully(footer);
    for (int i = 0; i < SIG_BLOCK_MAGIC.length; i++) {
      if (footer[8 + i] != SIG_BLOCK_MAGIC[i]) {
        return null;
      }
    }
    long size = u64(footer, 0);
    if (size < 24 || size > cdOffset - 8) {
      return null;
    }
    long blockStart = cdOffset - size - 8;
    if (blockStart < 0) {
      return null;
    }
    byte[] headerSize = new byte[8];
    raf.seek(blockStart);
    raf.readFully(headerSize);
    if (u64(headerSize, 0) != size) {
      return null;
    }
    long pairsLen = size - 24;
    if (pairsLen < 0 || pairsLen > Integer.MAX_VALUE) {
      return null;
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
    List<String> certs = sha256Hexes(new File(args[0]));
    if (certs.isEmpty()) {
      System.err.println("unreadable");
      System.exit(1);
    }
    for (int i = 0; i < certs.size(); i++) {
      System.out.println(certs.get(i));
    }
  }
}
