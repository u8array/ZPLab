import { describe, it, expect } from "vitest";
import { encodeContent, markerUnsafeChars, markerStandIn, parseContent, recommendedEc, isContentComplete, typedContentFieldIssues, typedContentIncompleteRows, typedContentMarkerFindings, type ContentType, type ContentFields, CONTENT_TYPES, MECARD_FIELDS, VCARD_FIELDS } from "@zplab/core/lib/typedContent";

function roundtrip(type: ContentType, fields: ContentFields) {
  const parsed = parseContent(encodeContent(type, fields));
  expect(parsed.type).toBe(type);
  return parsed.fields;
}

describe("encodeContent", () => {
  it("URL: keeps a scheme, adds https:// when missing", () => {
    expect(encodeContent("url", { url: "https://x.io/a" })).toBe("https://x.io/a");
    expect(encodeContent("url", { url: "example.com" })).toBe("https://example.com");
  });

  it("WiFi: ZXing format, omits P for nopass, H only when hidden", () => {
    expect(encodeContent("wifi", { ssid: "net", password: "pw", auth: "WPA" })).toBe("WIFI:T:WPA;S:net;P:pw;;");
    expect(encodeContent("wifi", { ssid: "net", auth: "nopass", password: "x" })).toBe("WIFI:T:nopass;S:net;;");
    expect(encodeContent("wifi", { ssid: "net", password: "pw", auth: "WPA", hidden: "true" })).toBe(
      "WIFI:T:WPA;S:net;P:pw;H:true;;",
    );
  });

  it("WiFi: escapes specials (backslash first) and quotes all-hex values", () => {
    expect(encodeContent("wifi", { ssid: 'a;b,c"d\\e', password: "p", auth: "WPA" })).toBe(
      'WIFI:T:WPA;S:a\\;b\\,c\\"d\\\\e;P:p;;',
    );
    expect(encodeContent("wifi", { ssid: "ABCD", auth: "nopass" })).toContain('S:"ABCD";');
  });

  it("email: percent-encodes subject/body with CRLF newlines", () => {
    expect(encodeContent("email", { to: "a@b.c", subject: "Hi there", body: "l1\nl2" })).toBe(
      "mailto:a@b.c?subject=Hi%20there&body=l1%0D%0Al2",
    );
    expect(encodeContent("email", { to: "a@b.c" })).toBe("mailto:a@b.c");
  });

  it("tel/sms: normalize the number (keep +, strip separators)", () => {
    expect(encodeContent("tel", { number: "+1 (212) 555-0123" })).toBe("tel:+12125550123");
    expect(encodeContent("sms", { number: "0151 234", message: "hi" })).toBe("SMSTO:0151234:hi");
  });

  it("geo/vcard basics", () => {
    expect(encodeContent("geo", { lat: "48.20", lng: "16.37" })).toBe("geo:48.20,16.37");
    expect(encodeContent("vcard", { firstName: "Sean", lastName: "Owen", email: "s@x.io" })).toBe(
      "BEGIN:VCARD\nVERSION:3.0\nN:Owen;Sean;;;\nFN:Sean Owen\nEMAIL:s@x.io\nEND:VCARD",
    );
  });

  it("vcard: emits every field of the form, the phone as typed, the address as one ADR line", () => {
    const all = Object.fromEntries(VCARD_FIELDS.map((k) => [k, k]));
    const out = encodeContent("vcard", { ...all, tel: "+49 30 123", mobile: "+49 171 9", birthday: "1990-05-04" });
    expect(out).toBe(
      [
        "BEGIN:VCARD", "VERSION:3.0", "N:lastName;firstName;;;", "FN:firstName lastName", "ORG:org", "TITLE:title",
        "TEL:+49 30 123", "TEL;TYPE=CELL:+49 171 9", "EMAIL:email", "URL:url",
        "ADR:;;street;city;region;postalCode;country", "NOTE:note", "BDAY:1990-05-04", "END:VCARD",
      ].join("\n"),
    );
    for (const key of VCARD_FIELDS) {
      expect(out, key).toContain(key === "birthday" ? "1990-05-04" : key === "tel" ? "+49 30 123" : key === "mobile" ? "+49 171 9" : key);
      expect(markerUnsafeChars("vcard", key, "a;b"), key).toBe(";");
    }
    expect(encodeContent("vcard", { lastName: "O", city: "Wien" })).toContain("ADR:;;;Wien;;;");
    // Blank means absent, for every field alike.
    expect(encodeContent("vcard", { lastName: " O ", firstName: " ", tel: "  ", mobile: " ", birthday: " ", org: " A " })).toBe(
      "BEGIN:VCARD\nVERSION:3.0\nN:O;;;;\nFN:O\nORG:A\nEND:VCARD",
    );
  });

  it("mecard: every field, structural chars escaped, the birthday as digits", () => {
    const all = Object.fromEntries(MECARD_FIELDS.map((k) => [k, k]));
    expect(encodeContent("mecard", { ...all, lastName: "Do;e", birthday: "1990-05-04" })).toBe(
      "MECARD:N:Do\\;e,firstName;ORG:org;TEL:tel;EMAIL:email;URL:url;ADR:address;NOTE:note;BDAY:19900504;;",
    );
    expect(encodeContent("mecard", { lastName: "O", tel: "«num»", address: "a,b" })).toBe("MECARD:N:O;TEL:«num»;ADR:a\\,b;;");
    expect(encodeContent("mecard", { firstName: "J", birthday: "«birth-date»" })).toBe("MECARD:N:J;BDAY:«birth-date»;;");
    for (const key of MECARD_FIELDS) expect(markerUnsafeChars("mecard", key, "a;b"), key).toBe(";");
    expect(markerUnsafeChars("mecard", "birthday", "1990-05-04")).toBe("-");
    expect(markerUnsafeChars("mecard", "note", 'a"b')).toBeNull();
    expect(markerUnsafeChars("wifi", "ssid", 'a"b')).toBe('"');
    expect(markerUnsafeChars("vcard", "birthday", "1990-05-04")).toBeNull();
    expect(isContentComplete("mecard", { firstName: "A", birthday: "4.5.1990" })).toBe(false);
  });

  it("gs1link: the AIs encode to a Digital Link, both fields have a marker rule, and Apply needs a key", () => {
    const f = { ais: "(01)09506000134352(10)ABC(17)250101(3103)000123" };
    expect(encodeContent("gs1link", f)).toBe("https://id.gs1.org/01/09506000134352/10/ABC?17=250101&3103=000123");
    expect(encodeContent("gs1link", { domain: "brand.example.com", ais: "(01)«g»(21)S/1" })).toBe("https://brand.example.com/01/«g»/21/S%2F1");
    expect(markerUnsafeChars("gs1link", "ais", "a/b(")).toBe("/ (");
    expect(markerUnsafeChars("gs1link", "domain", "a b?")).toBe("␣ ?");
    expect(markerUnsafeChars("gs1link", "domain", "https://brand.example.com/p")).toBe("://");
    expect(markerUnsafeChars("gs1link", "domain", "brand.example.com:8080/p")).toBeNull();
    expect(encodeContent("gs1link", { domain: "«host»", ais: "(01)09506000134352" })).toBe("https://«host»/01/09506000134352");
    expect(isContentComplete("gs1link", f)).toBe(true);
    expect(isContentComplete("gs1link", { ais: "(10)ABC" })).toBe(false);
    expect(isContentComplete("gs1link", { ais: "(01)09506000134353" })).toBe(false);
    expect(isContentComplete("gs1link", { ais: "(00)123456789012345675" })).toBe(true);
    expect(isContentComplete("gs1link", { ais: "garbage" })).toBe(false);
    expect(isContentComplete("gs1link", { ais: "(01)09506000134352(10)A(B" })).toBe(false);
    expect(encodeContent("gs1link", { ais: "(01)9506000134352" })).toBe("https://id.gs1.org/01/09506000134352");
    expect(isContentComplete("gs1link", { ais: "(01)9506000134352" }, { ais: "(01)«g»" })).toBe(false);
    expect(isContentComplete("gs1link", { ais: "(01)09506000134352" }, { ais: "(01)«g»" })).toBe(true);
    expect(isContentComplete("gs1link", { ais: "(01)09506000134352(10)" }, { ais: "(01)09506000134352(10)«lot»" })).toBe(true);
    expect(isContentComplete("gs1link", { ais: "(01)09506000134352(10)" }, { ais: "(01)09506000134352(10)«lot»" }, false)).toBe(false);
    expect(isContentComplete("gs1link", { ais: "(01)(10)L" }, { ais: "(01)«g»(10)L" })).toBe(false);
    expect(parseContent("https://«host»/01/09506000134352").fields).toEqual({ domain: "https://«host»", ais: "(01)09506000134352" });
    expect(isContentComplete("gs1link", { domain: "", ais: "(01)09506000134352" }, { domain: "«host»", ais: "(01)09506000134352" })).toBe(true);
    expect(isContentComplete("gs1link", { domain: "", ais: "(01)09506000134352" }, { domain: "«host»", ais: "(01)09506000134352" }, false)).toBe(false);
    // A tag inside a value stays in that value, so the row's own rule refuses it.
    expect(isContentComplete("gs1link", { ais: "(01)09506000134352(10)A\\(11\\)250101" })).toBe(false);
    expect(encodeContent("gs1link", { ais: "(01)09506000134352(10)«a(11)b»" })).toBe("https://id.gs1.org/01/09506000134352/10/«a(11)b»");
  });

  it("gs1link: field issues name the AI rule, the link's shape and the set", () => {
    const gtin = "(01)09506000134352";
    expect(typedContentFieldIssues("gs1link", { ais: "(01)123A(17)251345" })).toEqual({ ais: { kind: "gs1", ai: "01", reason: "digitsOnly" } });
    expect(typedContentFieldIssues("gs1link", { ais: `${gtin}(17)251345` })).toEqual({ ais: { kind: "gs1", ai: "17", reason: "dateMonth" } });
    expect(typedContentFieldIssues("gs1link", { ais: `${gtin}(00)123456789012345675` })).toEqual({ ais: { kind: "gs1Link", issue: { kind: "twoPrimaryKeys" } } });
    expect(typedContentFieldIssues("gs1link", { ais: `${gtin}(10)L1(10)L2` })).toEqual({ ais: { kind: "gs1Link", issue: { kind: "duplicateAi", ai: "10" } } });
    expect(typedContentFieldIssues("gs1link", { ais: `${gtin}(10)L1(235)X` })).toEqual({ ais: { kind: "gs1Link", issue: { kind: "mixedQualifiers", ai: "235" } } });
    expect(typedContentFieldIssues("gs1link", { ais: `${gtin}(37)10` })).toMatchObject({ ais: { kind: "gs1Set", error: { key: "exclusiveAis" } } });
    expect(typedContentFieldIssues("gs1link", { ais: `${gtin}(4300)Acme` })).toEqual({});
    expect(typedContentFieldIssues("gs1link", { ais: gtin, domain: "https://x.com/?a=b" })).toEqual({ domain: { kind: "domain" } });
    expect(typedContentFieldIssues("gs1link", { ais: "(01)9506000134353" })).toEqual({ ais: { kind: "gs1", ai: "01", reason: "checkDigit" } });
    expect(typedContentFieldIssues("gs1link", { ais: `${gtin}(3103)12` })).toMatchObject({ ais: { kind: "gs1", ai: "3103" } });
    expect(typedContentFieldIssues("gs1link", { ais: "(10)ABC" })).toEqual({ ais: { kind: "gs1Link", issue: { kind: "noPrimaryKey" } } });
    expect(typedContentFieldIssues("gs1link", { ais: "" })).toEqual({ ais: { kind: "gs1Link", issue: { kind: "noPrimaryKey" } } });
    expect(typedContentFieldIssues("gs1link", { ais: `${gtin}(10)A(B` })).toEqual({ ais: { kind: "gs1", ai: "10", reason: "charset" } });
    // A pasted link can carry what the palette refuses.
    expect(parseContent("https://id.gs1.org/01/09506000134352?00=123456789012345675").fields.ais).toBe(`${gtin}(00)123456789012345675`);
    expect(parseContent("https://id.gs1.org/01/09506000134352?235=X&10=L").fields.ais).toBe(`${gtin}(235)X(10)L`);
    expect(typedContentFieldIssues("gs1link", { ais: `${gtin}(235)X(10)L` })).toEqual({ ais: { kind: "gs1Link", issue: { kind: "mixedQualifiers", ai: "235" } } });
  });

  it("field issues reach the other types only through the birthday", () => {
    expect(typedContentFieldIssues("vcard", { birthday: "4.5.1990" })).toEqual({ birthday: { kind: "date" } });
    for (const type of CONTENT_TYPES) {
      if (type === "vcard" || type === "mecard" || type === "gs1link") continue;
      expect(typedContentFieldIssues(type, { url: "x", birthday: "4.5.1990", ais: "x" }), type).toEqual({});
    }
  });

  it("vcard: the birthday must be a date a scanner keeps", () => {
    expect(isContentComplete("vcard", { lastName: "O", birthday: "1990-05-04" })).toBe(true);
    expect(isContentComplete("vcard", { lastName: "O", birthday: "19900504" })).toBe(true);
    expect(isContentComplete("vcard", { lastName: "O", birthday: markerStandIn("birthday") })).toBe(true);
    for (const bad of ["0", "4.5.1990", "1990-05-04T10:00:00Z"]) expect(isContentComplete("vcard", { lastName: "O", birthday: bad }), bad).toBe(false);
  });
});

describe("marker-aware encoding (tokens stay atomic)", () => {
  it("WiFi: escapes only literal spans, never a marker body; skips hex-quoting", () => {
    expect(encodeContent("wifi", { ssid: "a;«ssid»", password: "«pw»", auth: "WPA" })).toBe(
      "WIFI:T:WPA;S:a\\;«ssid»;P:«pw»;;",
    );
    // All-hex literal around a marker must NOT be quoted (resolved value unknown).
    expect(encodeContent("wifi", { ssid: "AB«x»", auth: "nopass" })).toContain("S:AB«x»;");
  });

  it("vCard: escapes literal specials, marker atomic", () => {
    expect(encodeContent("vcard", { firstName: "«first»", lastName: "a,b" })).toContain(
      "N:a\\,b;«first»;;;",
    );
  });

  it("tel/sms: strips literal non-digits, keeps marker letters", () => {
    expect(encodeContent("tel", { number: "+49 «num»" })).toBe("tel:+49«num»");
    expect(encodeContent("sms", { number: "«num»", message: "hi «who»" })).toBe("SMSTO:«num»:hi «who»");
  });

  it("email: percent-encodes literals only", () => {
    expect(encodeContent("email", { to: "a@b.c", subject: "Order «id» ready" })).toBe(
      "mailto:a@b.c?subject=Order%20«id»%20ready",
    );
  });

  it("url: leading marker suppresses the https:// prefix", () => {
    expect(encodeContent("url", { url: "«link»" })).toBe("«link»");
    expect(encodeContent("url", { url: "x.io/«path»" })).toBe("https://x.io/«path»");
  });

  it("round-trips marker payloads through parseContent", () => {
    expect(roundtrip("wifi", { ssid: "a;«ssid»", password: "«pw»", auth: "WPA" })).toMatchObject({
      ssid: "a;«ssid»",
      password: "«pw»",
    });
    expect(roundtrip("tel", { number: "«num»" })).toEqual({ number: "«num»" });
    expect(roundtrip("geo", { lat: "«lat»", lng: "«lng»" })).toEqual({ lat: "«lat»", lng: "«lng»" });
    expect(roundtrip("sms", { number: "«num»", message: "hi «who»" })).toEqual({
      number: "«num»",
      message: "hi «who»",
    });
  });
});

describe("markerUnsafeChars (print-time substituted values bypass literal escaping)", () => {
  it("flags WiFi structural chars in a substituted value, deduped", () => {
    expect(markerUnsafeChars("wifi", "ssid", 'A;B;C"')).toBe('; "');
    expect(markerUnsafeChars("wifi", "password", "p\\w")).toBe("\\");
  });

  it("flags vCard and mailto structural chars (incl. percent and whitespace)", () => {
    expect(markerUnsafeChars("vcard", "lastName", "a,b;c")).toBe(", ;");
    expect(markerUnsafeChars("email", "subject", "a&b#c")).toBe("& #");
    expect(markerUnsafeChars("email", "subject", "a b%c")).toBe("␣ %");
  });

  it("returns null for safe values and for fields whose literals are raw anyway", () => {
    expect(markerUnsafeChars("wifi", "ssid", "plainnet")).toBeNull();
    expect(markerUnsafeChars("url", "url", "a;b&c")).toBeNull();
    expect(markerUnsafeChars("sms", "message", "hi; there")).toBeNull();
  });
});

describe("typedContentMarkerFindings", () => {
  const vars = [{ id: "s", name: "ssid", fnNumber: 1, defaultValue: "SafeNet" }];

  it("does NOT flag structural chars in the field's LITERAL text (the encoder escapes those)", () => {
    expect(typedContentMarkerFindings("wifi", { ssid: "a;b«ssid»" }, vars, null, null)).toEqual({});
  });

  it("flags an unsafe variable default", () => {
    const dirty = [{ id: "s", name: "ssid", fnNumber: 1, defaultValue: "A;B" }];
    expect(typedContentMarkerFindings("wifi", { ssid: "«ssid»" }, dirty, null, null)).toEqual({ ssid: ";" });
  });

  it("flags an unsafe bound CSV cell even when the default is clean", () => {
    const dataset = { headers: ["net"], rows: [["ok"], ["A;B"]] };
    const columnMapping = { bindings: { s: "net" }, headerSnapshot: ["net"] };
    expect(typedContentMarkerFindings("wifi", { ssid: "«ssid»" }, vars, dataset, columnMapping)).toEqual({ ssid: ";" });
  });

  it("ignores marker-free fields and unbound datasets", () => {
    const dataset = { headers: ["net"], rows: [["A;B"]] };
    expect(typedContentMarkerFindings("wifi", { ssid: "literal;net" }, vars, dataset, null)).toEqual({});
  });
});

describe("typedContentIncompleteRows", () => {
  const vars = [{ id: "s", name: "ssid", fnNumber: 1, defaultValue: "SafeNet" }];

  it("reports 1-based rows whose substitution blanks a required field", () => {
    const dataset = { headers: ["net"], rows: [[""], ["ok"], [""]] };
    const columnMapping = { bindings: { s: "net" }, headerSnapshot: ["net"] };
    expect(typedContentIncompleteRows("wifi", { ssid: "«ssid»" }, vars, dataset, columnMapping)).toEqual([1, 3]);
  });

  it("checks only the defaults without a bound dataset ([0] when they fail)", () => {
    const empty = [{ id: "s", name: "ssid", fnNumber: 1, defaultValue: "" }];
    expect(typedContentIncompleteRows("wifi", { ssid: "«ssid»" }, empty, null, null)).toEqual([0]);
    expect(typedContentIncompleteRows("wifi", { ssid: "«ssid»" }, vars, null, null)).toEqual([]);
  });

  it("validates the defaults when a bound dataset has 0 rows (they still print)", () => {
    const empty = [{ id: "s", name: "ssid", fnNumber: 1, defaultValue: "" }];
    const dataset = { headers: ["net"], rows: [] as string[][] };
    const columnMapping = { bindings: { s: "net" }, headerSnapshot: ["net"] };
    expect(typedContentIncompleteRows("wifi", { ssid: "«ssid»" }, empty, dataset, columnMapping)).toEqual([0]);
  });

  it("treats clock markers as fixed-width digits (never empty), unbound vars as their default", () => {
    const dataset = { headers: ["x"], rows: [["cell"]] };
    const columnMapping = { bindings: {}, headerSnapshot: ["x"] };
    expect(typedContentIncompleteRows("tel", { number: "«clock:H»" }, vars, null, null)).toEqual([]);
    expect(typedContentIncompleteRows("wifi", { ssid: "«ssid»" }, vars, dataset, columnMapping)).toEqual([]);
  });
});

describe("parseContent round-trips", () => {
  it("url / text", () => {
    expect(roundtrip("url", { url: "https://x.io/a" })).toEqual({ url: "https://x.io/a" });
    expect(roundtrip("text", { text: "hello world" })).toEqual({ text: "hello world" });
  });
  it("wifi incl. escaped specials and all-hex", () => {
    expect(roundtrip("wifi", { ssid: 'a;b,c"d\\e', password: "p:w", auth: "WPA" })).toMatchObject({
      ssid: 'a;b,c"d\\e',
      password: "p:w",
      auth: "WPA",
    });
    expect(roundtrip("wifi", { ssid: "ABCD", auth: "nopass" }).ssid).toBe("ABCD");
  });
  it("vcard / email / tel / sms / geo", () => {
    expect(roundtrip("vcard", { firstName: "Sean", lastName: "Owen", org: "ACME", email: "s@x.io" })).toMatchObject({
      firstName: "Sean", lastName: "Owen", org: "ACME", email: "s@x.io",
    });
    const full = { firstName: "A", lastName: "B", tel: "+49 30 1", mobile: "+49 171 2", street: "Weg 1, Hof", city: "Wien", region: "W", postalCode: "1010", country: "AT", note: "x;y", birthday: "1990-05-04" };
    expect(roundtrip("vcard", full)).toMatchObject(full);
    const card = (...lines: string[]) => parseContent(["BEGIN:VCARD", "VERSION:3.0", "N:B;A;;;", ...lines, "END:VCARD"].join("\n")).fields;
    expect(card("TEL;TYPE=WORK,VOICE:1", "TEL;type=cell:2", "TEL;CELL:3", "TEL:4")).toMatchObject({ tel: "1", mobile: "2" });
    // The first non-empty repeated property is the one the form shows, as a scanner's primary.
    expect(card("EMAIL:a@b.c", "EMAIL:d@e.f", "ADR;TYPE=WORK:;;W St;;;;", "ADR;TYPE=HOME:;;H St;;;;")).toMatchObject({ email: "a@b.c", street: "W St" });
    expect(card("EMAIL:", "EMAIL:real@x.io", "ADR;TYPE=HOME:;;;;;;", "ADR;TYPE=WORK:;;H St;Graz;;;AT", "TEL:", "TEL:1")).toMatchObject({ email: "real@x.io", street: "H St", city: "Graz", country: "AT", tel: "1" });
    // Unfolding drops the line break and the one space after it (RFC 2425), so the fold sat inside a word.
    expect(card("NOTE:a long note that an exp", " orter folds")).toMatchObject({ note: "a long note that an exporter folds" });
    expect(roundtrip("email", { to: "a@b.c", subject: "Hi", body: "l1\nl2" })).toEqual({
      to: "a@b.c", subject: "Hi", body: "l1\nl2",
    });
    expect(roundtrip("sms", { number: "12125550123", message: "hi" })).toEqual({
      number: "12125550123", message: "hi",
    });
    expect(roundtrip("geo", { lat: "48.2", lng: "16.37" })).toEqual({ lat: "48.2", lng: "16.37" });
  });
  it("mecard, including repeated and unknown properties", () => {
    const full = { firstName: "A", lastName: "B;C", org: "ACME", tel: "+49 1", email: "a@b.c", url: "https://x.io", address: "Weg 1, Wien", note: "n:1", birthday: "1990-05-04" };
    expect(roundtrip("mecard", full)).toEqual(full);
    expect(parseContent("mecard:N:Doe,John;TEL:;TEL:1;TEL:2;NICKNAME:JD;BDAY:19900504;BDAY:Mai;;").fields).toEqual({ lastName: "Doe", firstName: "John", tel: "1", birthday: "1990-05-04" });
    expect(roundtrip("mecard", { lastName: "Doe" })).toEqual({ lastName: "Doe" });
  });
});

describe("parseContent never throws on malformed input", () => {
  it("keeps a raw value when percent-decoding fails", () => {
    expect(() => parseContent("mailto:a@b.c?subject=%")).not.toThrow();
    expect(parseContent("mailto:%E0%A4%A").type).toBe("email"); // truncated escape
    expect(parseContent("mailto:a@b.c?subject=%").fields.subject).toBe("%");
  });
  it("keeps '=' inside a mailto body (splits on the first = only)", () => {
    expect(parseContent("mailto:a@b.c?body=a=b").fields.body).toBe("a=b");
  });
  it("skips a malformed WiFi field without a colon and parses the rest", () => {
    const r = parseContent("WIFI:T:WPA;S:net;BADFIELD;P:pw;;");
    expect(r.type).toBe("wifi");
    expect(r.fields).toMatchObject({ auth: "WPA", ssid: "net", password: "pw" });
  });
});

describe("parseContent classification", () => {
  it("matches URI schemes case-insensitively and falls back to text", () => {
    expect(parseContent("MAILTO:a@b.c").type).toBe("email");
    expect(parseContent("Wifi:T:WPA;S:x;;").type).toBe("wifi");
    expect(parseContent("just some text").type).toBe("text");
    expect(parseContent("MECARD:N:Doe,John;;").type).toBe("mecard");
    expect(parseContent("https://id.gs1.org/01/09506000134352/10/ABC?17=250101")).toEqual({
      type: "gs1link",
      fields: { domain: "", ais: "(01)09506000134352(10)ABC(17)250101" },
    });
    expect(parseContent("https://brand.example.com/p/01/09506000134352/21/S1?3103=000123&10=L2").fields).toEqual({
      domain: "https://brand.example.com/p", ais: "(01)09506000134352(21)S1(3103)000123(10)L2",
    });
    expect(parseContent("https://id.gs1.org/01/9506000134352").fields).toEqual({ domain: "", ais: "(01)9506000134352" });
    expect(parseContent("https://id.gs1.org/00/123456789012345675").type).toBe("gs1link");
    expect(parseContent("https://id.gs1.org/01/3234234234").type).toBe("url");
    expect(parseContent("https://example.com/01/12").type).toBe("url");
    expect(typedContentFieldIssues("gs1link", { ais: "(01)x" })).toEqual({ ais: { kind: "gs1", ai: "01", reason: "digitsOnly" } });
    expect(encodeContent("gs1link", { ais: "(01)3234234234" })).toBe("https://id.gs1.org/01/00032342342340");
    expect(parseContent("https://id.gs1.org/01/09506000134352?linkType=gs1:pip").type).toBe("url");
    expect(parseContent("https://blog.example.com/2024/01/12").type).toBe("url");
    expect(parseContent("https://example.com/01/09506000134352?4300=A%28B").type).toBe("url");
    expect(parseContent("https://example.com/01/09506000134352/10/A%28B").type).toBe("url");
    expect(parseContent("geo:1,2").type).toBe("geo");
  });
});

describe("isContentComplete", () => {
  it("requires a digit for tel/sms", () => {
    expect(isContentComplete("tel", { number: "abc" })).toBe(false);
    expect(isContentComplete("tel", { number: "+49 30 1" })).toBe(true);
    expect(isContentComplete("sms", { number: "" })).toBe(false);
  });
  it("requires in-range numeric coordinates for geo", () => {
    expect(isContentComplete("geo", { lat: "abc", lng: "1" })).toBe(false);
    expect(isContentComplete("geo", { lat: "91", lng: "0" })).toBe(false); // lat out of range
    expect(isContentComplete("geo", { lat: "48.2", lng: "16.37" })).toBe(true);
  });
  it("requires the key field for the simple types", () => {
    expect(isContentComplete("url", { url: "" })).toBe(false);
    expect(isContentComplete("wifi", { ssid: "net" })).toBe(true);
    expect(isContentComplete("vcard", { firstName: "A" })).toBe(true);
  });
});

describe("recommendedEc", () => {
  it("suggests by length", () => {
    expect(recommendedEc("x")).toBe("Q");
    expect(recommendedEc("x".repeat(200))).toBe("M");
    expect(recommendedEc("x".repeat(400))).toBe("L");
  });
});
