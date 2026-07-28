/**
 * Text out of the files a recruiter actually has: .pdf, .docx, .txt, .md.
 *
 * WHY THIS EXISTS. The earlier build read plain text only, and said so in the plan: "PDF or
 * .docx parsing means a dependency and a build step, which #8 AC9 forbids." That traded a PRD
 * acceptance condition for an engineering convenience. PRD §6 AC3 is "output lands where their
 * work already happens — if it has to be copied out of one tool and reformatted into another,
 * that friction is the thing that kills it in week three", and §4's guardrail is that a pack
 * slower than the email it replaces has already failed. Every CV in existence is a .pdf or a
 * .docx. Making the recruiter open one, select all and hand-paste IS that friction, on the very
 * first step of the flow.
 *
 * NO DEPENDENCY AND NO BUILD STEP, so AC9 still holds. Both formats decompress with
 * `DecompressionStream`, which is in the platform — .docx is a ZIP of XML and is parsed with
 * `DOMParser`; .pdf is parsed here because nothing native reads one.
 *
 * HONEST FAILURE IS THE LOAD-BEARING PART. A silently garbled CV is worse than no upload at
 * all: every source_quote would fail the literal-quote check in src/provenance.js, the whole
 * pack would demote to unverified, and the recruiter would blame the product rather than the
 * file. So everything here ends at `looksLikeText`, and anything that does not read cleanly —
 * a scanned PDF, an encrypted one, a font with no usable character map — is reported as
 * unreadable with the paste fallback named, never returned as best-effort mush.
 *
 * Exposes one function on `window.DossierExtract`. No module system, same as app.js.
 */
(function (global) {
  "use strict";

  var PDF_RE = /\.pdf$/i;
  var DOCX_RE = /\.docx$/i;
  var TEXT_RE = /\.(txt|md|markdown)$/i;

  /* ── the platform's inflate ─────────────────────────────────────────────────────────────── */

  /**
   * `format` is "deflate" for a zlib-wrapped stream (PDF /FlateDecode) and "deflate-raw" for a
   * bare one (ZIP method 8). Producers disagree about the wrapper often enough that the PDF
   * path tries both rather than trusting the spec.
   */
  function inflate(bytes, format) {
    if (typeof global.DecompressionStream !== "function") {
      return Promise.reject(new Error("no-decompression"));
    }
    var stream = new Blob([bytes]).stream().pipeThrough(new global.DecompressionStream(format));
    return new Response(stream).arrayBuffer().then(function (buf) {
      return new Uint8Array(buf);
    });
  }

  function inflateEither(bytes) {
    return inflate(bytes, "deflate").catch(function () {
      return inflate(bytes, "deflate-raw");
    });
  }

  /** Bytes as one char per byte, so byte offsets and string indices stay the same number. */
  function latin1(bytes) {
    var out = "";
    for (var i = 0; i < bytes.length; i += 0x8000) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return out;
  }

  /* ── is what came out actually text? ────────────────────────────────────────────────────── */

  /**
   * The backstop described in the header. Two independent signals, because each has a blind
   * spot: a control-character ratio catches Identity-H glyph indices decoded as Latin-1, and a
   * vowel check catches the case where the bytes happen to land in the printable range but
   * spell nothing.
   */
  function looksLikeText(text) {
    var t = String(text || "").trim();
    if (t.length < 40) return false;

    var clean = 0;
    for (var i = 0; i < t.length; i++) {
      var c = t.charCodeAt(i);
      if (c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126) || (c >= 160 && c <= 0x2fff)) {
        clean++;
      }
    }
    if (clean / t.length < 0.9) return false;

    var words = t.split(/\s+/).filter(function (w) { return w.length > 2; });
    if (words.length < 15) return false;
    var withVowel = words.filter(function (w) { return /[aeiouyAEIOUY]/.test(w); }).length;
    return withVowel / words.length > 0.5;
  }

  /* ── .docx ──────────────────────────────────────────────────────────────────────────────── */

  var W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

  /**
   * A .docx is a ZIP. Read its central directory rather than scanning for local headers: the
   * central directory is the authoritative index, and a local header's sizes may be zeroed with
   * the real values in a trailing data descriptor.
   */
  function unzipEntry(bytes, wanted) {
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var eocd = -1;
    for (var i = bytes.length - 22; i >= 0 && i > bytes.length - 66000; i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return Promise.reject(new Error("not-a-zip"));

    var count = view.getUint16(eocd + 10, true);
    var pos = view.getUint32(eocd + 16, true);

    for (var n = 0; n < count; n++) {
      if (view.getUint32(pos, true) !== 0x02014b50) break;
      var method = view.getUint16(pos + 10, true);
      var compressed = view.getUint32(pos + 20, true);
      var nameLen = view.getUint16(pos + 28, true);
      var extraLen = view.getUint16(pos + 30, true);
      var commentLen = view.getUint16(pos + 32, true);
      var localAt = view.getUint32(pos + 42, true);
      var name = latin1(bytes.subarray(pos + 46, pos + 46 + nameLen));

      if (name === wanted) {
        if (view.getUint32(localAt, true) !== 0x04034b50) return Promise.reject(new Error("bad-zip"));
        var lNameLen = view.getUint16(localAt + 26, true);
        var lExtraLen = view.getUint16(localAt + 28, true);
        var start = localAt + 30 + lNameLen + lExtraLen;
        var data = bytes.subarray(start, start + compressed);
        if (method === 0) return Promise.resolve(data);
        if (method === 8) return inflate(data, "deflate-raw");
        return Promise.reject(new Error("zip-method"));
      }
      pos += 46 + nameLen + extraLen + commentLen;
    }
    return Promise.reject(new Error("no-document-xml"));
  }

  function docxToText(bytes) {
    return unzipEntry(bytes, "word/document.xml").then(function (xmlBytes) {
      var xml = new TextDecoder("utf-8").decode(xmlBytes);
      var doc = new DOMParser().parseFromString(xml, "application/xml");
      if (doc.getElementsByTagName("parsererror").length) throw new Error("bad-xml");

      // One line per w:p, which is what a reader sees as a paragraph or a bullet. Tables come
      // out row by row, which is enough for a CV's skills grid.
      var paras = doc.getElementsByTagNameNS(W_NS, "p");
      var lines = [];
      for (var i = 0; i < paras.length; i++) {
        var walker = doc.createTreeWalker(paras[i], NodeFilter.SHOW_ELEMENT);
        var buf = "";
        var node = walker.currentNode;
        while (node) {
          if (node.namespaceURI === W_NS) {
            if (node.localName === "t") buf += node.textContent;
            else if (node.localName === "tab") buf += "\t";
            else if (node.localName === "br" || node.localName === "cr") buf += "\n";
          }
          node = walker.nextNode();
        }
        lines.push(buf.trim());
      }
      return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    });
  }

  /* ── .pdf ───────────────────────────────────────────────────────────────────────────────── */

  /** PDF string literal: `(...)` with escapes and balanced inner parens. */
  function readLiteral(s, i) {
    var out = "";
    var depth = 1;
    while (i < s.length) {
      var c = s[i];
      if (c === "\\") {
        var n = s[i + 1];
        if (n === "n") { out += "\n"; i += 2; }
        else if (n === "r") { out += "\r"; i += 2; }
        else if (n === "t") { out += "\t"; i += 2; }
        else if (n === "b") { out += "\b"; i += 2; }
        else if (n === "f") { out += "\f"; i += 2; }
        else if (n >= "0" && n <= "7") {
          var oct = /^[0-7]{1,3}/.exec(s.slice(i + 1))[0];
          out += String.fromCharCode(parseInt(oct, 8));
          i += 1 + oct.length;
        } else if (n === "\n") { i += 2; }
        else { out += n; i += 2; }
      } else if (c === "(") { depth++; out += c; i++; }
      else if (c === ")") { depth--; if (!depth) return { text: out, next: i + 1 }; out += c; i++; }
      else { out += c; i++; }
    }
    return { text: out, next: i };
  }

  function hexToBytes(hex) {
    var h = hex.replace(/[^0-9a-fA-F]/g, "");
    if (h.length % 2) h += "0";
    var out = "";
    for (var i = 0; i < h.length; i += 2) out += String.fromCharCode(parseInt(h.substr(i, 2), 16));
    return out;
  }

  /**
   * A /ToUnicode CMap, reduced to the one thing needed: code -> string. `bytes` records whether
   * the font addresses glyphs with one byte or two, which is what decides how a shown string is
   * chopped up.
   */
  function parseCMap(src) {
    var map = Object.create(null);
    var width = 1;

    var csr = /begincodespacerange([\s\S]*?)endcodespacerange/g, m;
    while ((m = csr.exec(src))) {
      var first = /<([0-9a-fA-F]+)>/.exec(m[1]);
      if (first && first[1].length >= 4) width = 2;
    }

    var bfc = /beginbfchar([\s\S]*?)endbfchar/g;
    while ((m = bfc.exec(src))) {
      var pair = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g, p;
      while ((p = pair.exec(m[1]))) {
        if (p[1].length >= 4) width = 2;
        map[parseInt(p[1], 16)] = utf16be(p[2]);
      }
    }

    var bfr = /beginbfrange([\s\S]*?)endbfrange/g;
    while ((m = bfr.exec(src))) {
      var body = m[1];
      var rangeArr = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([\s\S]*?)\]/g, r;
      while ((r = rangeArr.exec(body))) {
        if (r[1].length >= 4) width = 2;
        var lo = parseInt(r[1], 16);
        var items = r[3].match(/<([0-9a-fA-F]*)>/g) || [];
        for (var k = 0; k < items.length; k++) map[lo + k] = utf16be(items[k].slice(1, -1));
      }
      var rangeSimple = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g;
      while ((r = rangeSimple.exec(body))) {
        if (r[1].length >= 4) width = 2;
        var a = parseInt(r[1], 16), b = parseInt(r[2], 16), base = parseInt(r[3], 16) || 0;
        if (b - a > 65535) continue;
        for (var c = a; c <= b; c++) map[c] = String.fromCharCode(base + (c - a));
      }
    }
    return { map: map, bytes: width };
  }

  function utf16be(hex) {
    var out = "";
    for (var i = 0; i + 3 < hex.length + 1; i += 4) {
      var code = parseInt(hex.substr(i, 4), 16);
      if (!isNaN(code)) out += String.fromCharCode(code);
    }
    return out;
  }

  /** Tokenizer for a content stream. Enough of the grammar to find shown text and where it sits. */
  function tokenize(s) {
    var toks = [];
    var i = 0;
    while (i < s.length) {
      var c = s[i];
      if (c === " " || c === "\n" || c === "\r" || c === "\t" || c === "\f" || c === "\0") { i++; continue; }
      if (c === "%") { while (i < s.length && s[i] !== "\n") i++; continue; }
      if (c === "(") { var lit = readLiteral(s, i + 1); toks.push({ t: "str", v: lit.text }); i = lit.next; continue; }
      if (c === "<" && s[i + 1] === "<") { toks.push({ t: "op", v: "<<" }); i += 2; continue; }
      if (c === ">" && s[i + 1] === ">") { toks.push({ t: "op", v: ">>" }); i += 2; continue; }
      if (c === "<") {
        var end = s.indexOf(">", i);
        if (end < 0) break;
        toks.push({ t: "str", v: hexToBytes(s.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
      if (c === "/") {
        var nm = /^\/([^\s/[\]<>(){}%]*)/.exec(s.slice(i));
        toks.push({ t: "name", v: nm ? nm[1] : "" });
        i += nm ? nm[0].length : 1;
        continue;
      }
      if (c === "[" || c === "]") { toks.push({ t: c }); i++; continue; }
      var num = /^[+-]?(\d+\.?\d*|\.\d+)/.exec(s.slice(i));
      if (num) { toks.push({ t: "num", v: parseFloat(num[0]) }); i += num[0].length; continue; }
      var op = /^[^\s/[\]<>(){}%]+/.exec(s.slice(i));
      if (!op) { i++; continue; }
      toks.push({ t: "op", v: op[0] });
      i += op[0].length;
    }
    return toks;
  }

  function decodeShown(raw, font) {
    if (!font || !font.map) {
      // No usable map: the font is a simple one and its codes are Latin-1-ish already.
      return raw;
    }
    var out = "";
    if (font.bytes === 2) {
      for (var i = 0; i + 1 < raw.length; i += 2) {
        var code = (raw.charCodeAt(i) << 8) | raw.charCodeAt(i + 1);
        out += code in font.map ? font.map[code] : "";
      }
    } else {
      for (var j = 0; j < raw.length; j++) {
        var c = raw.charCodeAt(j);
        out += c in font.map ? font.map[c] : raw[j];
      }
    }
    return out;
  }

  /**
   * Walk one content stream, emitting text and a newline whenever the text cursor moves to a
   * different baseline. Line breaks matter more here than in a general extractor: the pack's
   * source quotes are checked literally, so a CV whose bullets run together changes what a
   * quote can match.
   */
  function runContent(tokens, fonts, sink) {
    var stack = [];
    var font = null;
    var leading = 0;
    var y = 0, lastY = null;

    function show(raw) {
      if (lastY !== null && Math.abs(y - lastY) > 0.6) sink.push("\n");
      lastY = y;
      sink.push(decodeShown(raw, font));
    }

    for (var i = 0; i < tokens.length; i++) {
      var tk = tokens[i];
      if (tk.t !== "op") { stack.push(tk); continue; }

      var op = tk.v;
      if (op === "Tf") {
        var nameTok = stack[stack.length - 2];
        font = nameTok && nameTok.t === "name" ? fonts[nameTok.v] || null : null;
      } else if (op === "TL") {
        var l = stack[stack.length - 1];
        if (l && l.t === "num") leading = l.v;
      } else if (op === "Td" || op === "TD") {
        var ty = stack[stack.length - 1];
        if (ty && ty.t === "num") y += ty.v;
        if (op === "TD" && ty && ty.t === "num") leading = -ty.v;
      } else if (op === "Tm") {
        var f = stack[stack.length - 1];
        if (f && f.t === "num") y = f.v;
      } else if (op === "T*") {
        y -= leading;
      } else if (op === "Tj") {
        var s1 = stack[stack.length - 1];
        if (s1 && s1.t === "str") show(s1.v);
      } else if (op === "'" || op === '"') {
        y -= leading;
        var s2 = stack[stack.length - 1];
        if (s2 && s2.t === "str") show(s2.v);
      } else if (op === "TJ") {
        // Walk back to the matching "[" and replay it forwards, so kerning numbers keep their
        // place relative to the strings they separate.
        var open = -1;
        for (var b = stack.length - 1; b >= 0; b--) if (stack[b].t === "[") { open = b; break; }
        if (open >= 0) {
          var parts = [];
          for (var k = open + 1; k < stack.length; k++) {
            var it = stack[k];
            if (it.t === "str") parts.push(decodeShown(it.v, font));
            // A large negative adjustment is how a PDF writes a space it did not emit.
            else if (it.t === "num" && it.v < -150) parts.push(" ");
          }
          if (lastY !== null && Math.abs(y - lastY) > 0.6) sink.push("\n");
          lastY = y;
          sink.push(parts.join(""));
        }
      } else if (op === "ET") {
        sink.push("\n");
        lastY = null;
      }

      if (op !== "<<") stack.length = 0;
    }
  }

  /**
   * Pull every object out of the file, decompress what is compressed, and fold object streams
   * back into the searchable text so font dictionaries inside them are visible. Then map each
   * resource font name to its /ToUnicode CMap, and run every content stream.
   */
  function pdfToText(bytes) {
    var raw = latin1(bytes);
    var objRe = /(\d+)\s+\d+\s+obj\b/g;
    var found = [];
    var m;
    while ((m = objRe.exec(raw))) found.push({ num: parseInt(m[1], 10), at: m.index, bodyAt: objRe.lastIndex });

    var jobs = found.map(function (o) {
      var end = raw.indexOf("endobj", o.bodyAt);
      var slice = raw.slice(o.bodyAt, end < 0 ? o.bodyAt + 200000 : end);
      var sIdx = slice.indexOf("stream");
      if (sIdx < 0) return Promise.resolve({ num: o.num, dict: slice, data: null });

      var dict = slice.slice(0, sIdx);
      var dataStart = o.bodyAt + sIdx + 6;
      if (raw[dataStart] === "\r") dataStart++;
      if (raw[dataStart] === "\n") dataStart++;
      var dataEnd = raw.indexOf("endstream", dataStart);
      if (dataEnd < 0) return Promise.resolve({ num: o.num, dict: dict, data: null });

      // Prefer the dictionary's /Length over the distance to "endstream".
      //
      // Chrome's DecompressionStream rejects trailing bytes after the end of a deflate stream;
      // Node's tolerates them. The EOL a writer puts between the data and the `endstream`
      // keyword is exactly such a trailing byte, so searching for the keyword produced a
      // payload that inflates in Node and throws in every browser — every stream failed, and
      // the file came out empty rather than wrong, which is why it read as an unreadable PDF.
      // /Length is the authoritative byte count. It is only usable when it is a direct number:
      // an indirect `/Length 12 0 R` needs another lookup, and the trimmed fallback covers it.
      var lengthMatch = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
      var payload;
      if (lengthMatch && dataStart + Number(lengthMatch[1]) <= dataEnd) {
        payload = bytes.subarray(dataStart, dataStart + Number(lengthMatch[1]));
      } else {
        var trimEnd = dataEnd;
        while (trimEnd > dataStart) {
          var b = bytes[trimEnd - 1];
          if (b === 0x0a || b === 0x0d || b === 0x20) trimEnd--;
          else break;
        }
        payload = bytes.subarray(dataStart, trimEnd);
      }
      if (!/\/FlateDecode/.test(dict)) {
        return Promise.resolve({ num: o.num, dict: dict, data: latin1(payload) });
      }
      return inflateEither(payload)
        .then(function (out) { return { num: o.num, dict: dict, data: latin1(out) }; })
        .catch(function () { return { num: o.num, dict: dict, data: null }; });
    });

    return Promise.all(jobs).then(function (objs) {
      if (/\/Encrypt\b/.test(raw)) throw new Error("encrypted");

      var byNum = Object.create(null);
      var searchable = raw;
      objs.forEach(function (o) {
        byNum[o.num] = o;
        if (o.data && /\/ObjStm/.test(o.dict)) searchable += "\n" + o.data;
      });

      // /Font << /F1 12 0 R /F2 13 0 R >> — one map for the document. Two fonts sharing a
      // resource name across pages with different CMaps would collide; a CV does not do that,
      // and the looksLikeText backstop catches it if one does.
      var fonts = Object.create(null);
      var toUni = Object.create(null);
      var fontRe = /\/Font\s*<<([\s\S]*?)>>/g, fm;
      var refs = [];
      while ((fm = fontRe.exec(searchable))) {
        var entry = /\/([^\s/]+)\s+(\d+)\s+\d+\s+R/g, em;
        while ((em = entry.exec(fm[1]))) refs.push({ name: em[1], num: parseInt(em[2], 10) });
      }
      refs.forEach(function (r) {
        var fo = byNum[r.num];
        if (!fo) return;
        var tu = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(fo.dict);
        if (!tu) return;
        var key = tu[1];
        if (!(key in toUni)) {
          var cm = byNum[parseInt(key, 10)];
          toUni[key] = cm && cm.data ? parseCMap(cm.data) : null;
        }
        if (toUni[key]) fonts[r.name] = toUni[key];
      });

      var sink = [];
      objs.forEach(function (o) {
        if (!o.data) return;
        if (/\/ObjStm|\/XObject\s*\/Image|\/Type\s*\/(Font|XRef|Metadata)/.test(o.dict)) return;
        if (!/(BT|Tj|TJ)/.test(o.data)) return;
        runContent(tokenize(o.data), fonts, sink);
      });

      return unwrap(
        sink.join("")
          .replace(/\r/g, "")
          .replace(/[ \t]+\n/g, "\n")
          .replace(/\n{3,}/g, "\n\n")
          .replace(/[ \t]{2,}/g, " ")
          .trim()
      );
    });
  }

  /**
   * Rejoin lines a PDF broke for layout rather than for meaning.
   *
   * This is a provenance requirement, not tidying. A page sets "…no conditions or /
   * restrictions." on two lines; the model quotes what it is given; src/provenance.js then
   * searches for that quote literally. Leave the layout break in and quotes straddling it are
   * fragile and read as broken in the sources appendix — the one part of the pack a client is
   * meant to trust.
   *
   * Conservative on purpose: join only when the previous line ends mid-sentence AND the next
   * begins lowercase. A CV is mostly bullets and headings, and merging two bullets would invent
   * a claim spanning both — worse than leaving a break in.
   */
  function unwrap(text) {
    var lines = text.split("\n");
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var prev = out.length ? out[out.length - 1] : null;
      var joinable = prev !== null && prev !== "" && line !== "" &&
        !/[.:;!?)\]•]$/.test(prev) &&
        !/^\s*([-•*•]|\d+[.)])\s/.test(line) &&
        /^[a-z(]/.test(line);
      if (joinable) out[out.length - 1] = prev + (/[-‐-—]$/.test(prev) ? "" : " ") + line;
      else out.push(line);
    }
    return out.join("\n");
  }

  /* ── the one entry point ────────────────────────────────────────────────────────────────── */

  function bytesOf(file) {
    return file.arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }

  /**
   * Resolves { text, kind }. Rejects with an Error whose `.reason` is one of:
   *   "unsupported"  a file type this cannot read at all
   *   "unreadable"   the right type, but no usable text came out (scanned, encrypted, odd font)
   *   "failed"       it threw
   * The caller turns those into the sentence the recruiter sees.
   */
  function extractText(file) {
    var name = file && file.name ? file.name : "";
    var isText = /^text\//.test(file.type) || TEXT_RE.test(name);

    if (isText) {
      return file.text().then(function (t) { return { text: t, kind: "text" }; });
    }

    var isPdf = file.type === "application/pdf" || PDF_RE.test(name);
    var isDocx = DOCX_RE.test(name) ||
      file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    if (!isPdf && !isDocx) return Promise.reject(reason("unsupported"));

    return bytesOf(file)
      .then(function (bytes) { return isPdf ? pdfToText(bytes) : docxToText(bytes); })
      .then(function (text) {
        if (!looksLikeText(text)) throw reason("unreadable");
        return { text: text, kind: isPdf ? "pdf" : "docx" };
      })
      .catch(function (err) {
        throw err && err.reason ? err : reason(err && err.message === "encrypted" ? "unreadable" : "failed");
      });
  }

  function reason(code) {
    var e = new Error(code);
    e.reason = code;
    return e;
  }

  global.DossierExtract = { extractText: extractText, looksLikeText: looksLikeText };
})(window);
