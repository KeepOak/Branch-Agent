// Ported from JuliusBrussee/caveman@b39c90862855ad2f0813ce775b8bf07a9d6d2a50:engine/detect_test.go and engine/detect_html_test.go (atlas AGENT-LOOP-0349).
import { describe, expect, it } from "vitest";
import { detectContentType } from "./detect.js";

describe("TestDetect", () => {
  const cases: Array<[string, string, string]> = [
    ["json object", `{"a":1,"b":[1,2,3]}`, "json"],
    ["json array", "[1,2,3,4]", "json"],
    [
      "diff",
      "diff --git a/a.go b/a.go\n--- a/a.go\n+++ b/a.go\n@@ -1,5 +1,5 @@\n context\n-old\n+new\n context\n",
      "diff",
    ],
    ["go code", 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("hi")\n}\n', "code"],
    [
      "python code",
      "import os\n\ndef run(x):\n    return x + 1\n\nclass A:\n    def m(self):\n        return 2\n",
      "code",
    ],
    [
      "log",
      "2026-01-01T00:00:00Z [INFO] start\n[INFO] step\n[WARN] slow\n[ERROR] boom\n[INFO] end\n",
      "log",
    ],
    [
      "search results",
      "src/a.go:10:match\nsrc/b.go:11:match\nsrc/c.go:12:match\nsrc/d.go:13:match\nsrc/e.go:14:match\nsrc/f.go:15:match\n",
      "search-result",
    ],
    [
      "csv table",
      "name,region,revenue,status\nalpha,eu,120,ok\nbravo,us,140,ok\ncharlie,apac,90,ok\ndelta,eu,180,ok\necho,us,160,ok\nfoxtrot,apac,110,ok\ngolf,eu,200,ok\nhotel,us,170,ok\nindia,apac,130,ok\n",
      "tabular",
    ],
    [
      "markdown table",
      "| name | region | revenue |\n| --- | --- | ---: |\n| alpha | eu | 120 |\n| bravo | us | 140 |\n| charlie | apac | 90 |\n| delta | eu | 180 |\n| echo | us | 160 |\n| foxtrot | apac | 110 |\n",
      "tabular",
    ],
    [
      "yaml config",
      "service:\n  name: api\n  port: 8080\n  database:\n    host: db.internal\n    port: 5432\n    pool: 20\n  cache:\n    host: cache.internal\n    ttl: 300\n  limits:\n    requests: 1000\n    burst: 50\n  telemetry:\n    enabled: true\n    endpoint: http://otel.internal\n",
      "config",
    ],
    [
      "toml config",
      '[service]\nname = "api"\nport = 8080\n[database]\nhost = "db.internal"\nport = 5432\npool = 20\n[cache]\nhost = "cache.internal"\nttl = 300\n[limits]\nrequests = 1000\nburst = 50\n[telemetry]\nenabled = true\nendpoint = "http://otel.internal"\n',
      "config",
    ],
    [
      "prose",
      "The quick brown fox jumps over the lazy dog. Nothing structured here at all.",
      "text",
    ],
    ["empty", "", "text"],
  ];
  it.each(cases)("%s", (_name, input, want) => {
    expect(detectContentType(input)).toBe(want);
  });
});

describe("detect html", () => {
  it("TestDetectHTML", () => {
    const html =
      "<!doctype html><html><body><article><p>real article prose with enough text here</p></article></body></html>";
    expect(detectContentType(html)).toBe("html");
  });

  it("TestDetectJSXRoutesToCode", () => {
    const jsx =
      "import React from 'react'\n\n" +
      "export function Card({ title, items }) {\n" +
      "  return (\n" +
      '    <div className="card">\n' +
      "      <h2>{title}</h2>\n" +
      "      <ul>{items.map((it) => (<li key={it.id}>{it.name}</li>))}</ul>\n" +
      "    </div>\n" +
      "  )\n}\n";
    expect(detectContentType(jsx)).not.toBe("html");
  });

  it("TestDetectGoWithHTMLStringsNotHTML", () => {
    const src =
      'package render\n\nfunc wrap(s string) string {\n\treturn "<div><p>" + s + "</p></div>"\n}\n\nfunc tag() string {\n\treturn "<span>x</span>"\n}\n';
    expect(detectContentType(src)).not.toBe("html");
  });

  it("TestDetectLogWithCodeKeywords", () => {
    const log =
      "2026-01-01T00:00:00Z [INFO] handler return 200\n" +
      "2026-01-01T00:00:01Z [WARN] class loader slow\n" +
      "2026-01-01T00:00:02Z [ERROR] func dispatch failed\n" +
      "2026-01-01T00:00:03Z [INFO] return to pool\n";
    expect(detectContentType(log)).toBe("log");
  });
});
