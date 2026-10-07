import { getEncoding } from "js-tiktoken";
import { describe, expect, it } from "vitest";
import { ingestMbox, type MboxMetadata } from "./mbox-ingest.js";
import { mboxDocumentChunks } from "./mbox-read.js";
import { tokenizeMboxString } from "./mbox-tokenizer.js";

function message(headers: string, body: string): string {
  return `From sender@example.test Sat Jan 01 00:00:00 2022\nFrom: Sender <sender@example.test>\n${headers}\n\n${body}\n`;
}

function ingest(text: string, metadata?: MboxMetadata) {
  return ingestMbox({
    buffer: Buffer.from(text),
    filename: "archive.mbox",
    sourceUrl: "file:///archive.mbox",
    published: "source date",
    metadata,
    tokenizeString: tokenizeMboxString,
  });
}

function multipart(parts: string[], subtype = "mixed", close = true): string {
  return message(
    `Subject: HTML\nMIME-Version: 1.0\nContent-Type: multipart/${subtype}; boundary="part"`,
    parts.map((part) => `--part\n${part}`).join("\n") + (close ? "\n--part--" : ""),
  );
}

describe("MBOX conversion from AnythingLLM 4bff9da using real pinned parser", () => {
  it("emits ordered complete records with source defaults and real token counts", async () => {
    const { documents } = await ingest(
      message("Subject: First. mail.end", "first body") +
        message("Subject: Second mail", "second body"),
    );
    expect(documents).toHaveLength(2);
    expect(documents[0]).toMatchObject({
      title: "First-mail.end.mbox",
      docAuthor: '"Sender" <sender@example.test>',
      url: "file:///archive.mbox",
      published: "source date",
      description: "No description found.",
      docSource: "Mbox message file uploaded by the user.",
      chunkSource: "",
    });
    expect(documents.map((doc) => doc.pageContent.trim())).toEqual(["first body", "second body"]);
    for (const doc of documents) {
      expect(doc.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(doc.wordCount).toBe(doc.pageContent.split(" ").length);
      expect(doc.token_count_estimate).toBe(
        getEncoding("cl100k_base").encode(doc.pageContent).length,
      );
    }
    expect(documents[0]!.id).not.toBe(documents[1]!.id);
  });

  it("keeps all metadata overrides and readable-message numbering", async () => {
    const metadata = {
      title: "Import",
      docAuthor: "Owner",
      description: "Desc",
      docSource: "Archive",
      chunkSource: "Chunk",
    };
    const { documents } = await ingest(
      message("Subject: Empty", "") + message("", "readable") + message("", "next"),
      metadata,
    );
    expect(documents.map((doc) => doc.title)).toEqual([
      "Import - msg_1-archive.mbox",
      "Import - msg_2-archive.mbox",
    ]);
    expect(documents[0]).toMatchObject({ ...metadata, title: "Import - msg_1-archive.mbox" });
  });

  it("prefers plaintext over the HTML alternative", async () => {
    const { documents } = await ingest(
      multipart(
        ["Content-Type: text/plain\n\nplain wins", "Content-Type: text/html\n\n<p>html loses</p>"],
        "alternative",
      ),
    );
    expect(documents[0]!.pageContent.trim()).toBe("plain wins");
  });

  it("extracts HTML with source options while keeping hostile attachments inert", async () => {
    const { documents } = await ingest(
      multipart([
        'Content-Type: text/html; charset=utf-8\n\n<p>Hello <a href="file:///outside">reference</a></p>' +
          '<img src="https://tracker.test/pixel"><script>bad()</script><style>hide</style><noscript>nope</noscript>',
        'Content-Type: application/octet-stream\nContent-Disposition: attachment; filename="../outside.bin"\nContent-Transfer-Encoding: base64\n\nAAEC',
        'Content-Type: application/octet-stream\nContent-Disposition: attachment; filename="C:\\outside.bin"\nContent-Transfer-Encoding: base64\n\nQUJD',
      ]),
    );
    expect(documents).toHaveLength(1);
    expect(documents[0]!.pageContent).toContain("Hello reference [file:///outside]");
    expect(documents[0]!.pageContent).not.toMatch(
      /tracker|bad\(\)|hide|nope|AAEC|QUJD|outside.bin/,
    );
  });

  it("decodes nested related HTML without promoting CID attachment data", async () => {
    const { documents } = await ingest(
      multipart([
        'Content-Type: multipart/related; boundary="inner"\n\n--inner\nContent-Type: text/html\n\n<p>Nested body</p><img src="cid:pixel">\n--inner\nContent-Type: image/png\nContent-ID: <pixel>\nContent-Transfer-Encoding: base64\n\niVBORw0KGgo=\n--inner--',
      ]),
    );
    expect(documents[0]!.pageContent.trim()).toBe("Nested body");
  });

  it("decodes folded RFC2047 subjects and base64 Unicode content", async () => {
    const { documents } = await ingest(
      message(
        'Subject: =?UTF-8?B?Q2Fmw6k=?=\n =?UTF-8?B?IG1haWw=?=\nContent-Type: text/plain; charset="utf-8"\nContent-Transfer-Encoding: base64',
        Buffer.from("Bonjour café 😀").toString("base64"),
      ).replaceAll("\n", "\r\n"),
    );
    expect(documents[0]!.title).toBe("Cafe-mail.mbox");
    expect(documents[0]!.pageContent.trim()).toBe("Bonjour café 😀");
  });

  it("decodes quoted-printable windows-1252 and soft line breaks", async () => {
    const { documents } = await ingest(
      message(
        'Content-Type: text/plain; charset="windows-1252"\nContent-Transfer-Encoding: quoted-printable',
        "caf=E9 =\ncontinued =80",
      ),
    );
    expect(documents[0]!.pageContent.trim()).toBe("café continued €");
  });

  it("preserves lenient truncated multipart and malformed base64 outcomes", async () => {
    const multipartResult = await ingest(
      multipart(["Content-Type: text/plain\n\ntruncated body"], "mixed", false),
    );
    expect(multipartResult.documents[0]!.pageContent.trim()).toBe("truncated body");
    const base64Result = await ingest(message("Content-Transfer-Encoding: base64", "SGVsbG8!!!"));
    expect(base64Result.documents[0]!.pageContent.trim()).toBe("Hello");
  });

  it("retains quoted From and header-like literal body text", async () => {
    const { documents } = await ingest(
      message("Subject: Body", ">From quoted\nSubject: still body\nbody From "),
    );
    expect(documents).toHaveLength(1);
    expect(documents[0]!.pageContent).toContain(">From quoted\nSubject: still body\nbody From ");
  });

  it("distinguishes empty archives from successfully parsed unreadable mail", async () => {
    expect(await ingest("")).toEqual({
      success: false,
      reason: "No mail items found in archive.mbox.",
      documents: [],
    });
    expect(await ingest(message("Subject: Empty", ""))).toEqual({
      success: true,
      reason: null,
      documents: [],
    });
  });

  it.each(["From ", "From \n"])("completes an empty delimiter %j equivalently", async (input) => {
    expect(await ingest(input)).toEqual({ success: true, reason: null, documents: [] });
  });

  it.each(["\n", "\r\n"])(
    "flushes prior messages before an EOF delimiter using %j",
    async (newline) => {
      const result = await ingest(
        message("Subject: Earlier", "retained").replaceAll("\n", newline) + "From ",
      );
      expect(result.documents).toHaveLength(1);
      const original = await ingest(
        message("Subject: Earlier", "retained").replaceAll("\n", newline),
      );
      expect(result.documents[0]!.pageContent).toBe(original.documents[0]!.pageContent);
    },
  );

  it("uses exact source BPE, threshold and encoder-error fallback", () => {
    expect(tokenizeMboxString("hello world")).toBe(2);
    expect(tokenizeMboxString("")).toBe(0);
    expect(tokenizeMboxString("a".repeat(5119))).toBe(
      getEncoding("cl100k_base").encode("a".repeat(5119)).length,
    );
    expect(tokenizeMboxString("a".repeat(5120))).toBe(640);
    expect(tokenizeMboxString("<|endoftext|>")).toBe(Math.ceil("<|endoftext|>".length / 8));
  });

  it("serializes long escaped records losslessly with bounded pieces", async () => {
    const { documents } = await ingest(message("Subject: Escaped", "body"));
    const doc = {
      ...documents[0]!,
      docAuthor: undefined,
      pageContent: "x".repeat(1023) + "😀" + '\n"\\\u0000\ud800'.repeat(10000),
    };
    const chunks = [...mboxDocumentChunks([doc, doc])];
    expect(Math.max(...chunks.map((chunk) => chunk.length))).toBeLessThanOrEqual(6144);
    expect(chunks.join("")).toBe([JSON.stringify(doc), JSON.stringify(doc)].join("\n"));
    expect(JSON.parse(chunks.join("").split("\n")[0]!)).toEqual(JSON.parse(JSON.stringify(doc)));
    expect([...mboxDocumentChunks([])]).toEqual(["[]"]);
  });

  it("rejects cancellation before parsing without fabricating success", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      ingestMbox({
        buffer: Buffer.from("From "),
        filename: "x.mbox",
        sourceUrl: "x",
        published: "unknown",
        tokenizeString: tokenizeMboxString,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });
});
