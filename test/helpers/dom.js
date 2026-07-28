// A document-shaped object that records structure instead of being a browser (#21).
//
// It does NOT lay anything out, does not compute style, does not move focus and does not
// dispatch events — and the tests must not pretend otherwise. What it makes directly assertable
// is the thing a real browser would only imply: which elements a constructor built, what it put
// in their attributes and classes, and which strings reached the page. Whether focus is visible,
// whether the tab order is sane and whether a disclosure operates from the keyboard are checked
// by hand in real Safari and real Chrome, because a fake DOM stretched far enough to "prove"
// keyboard operability would hand this ticket a green tick on the one criterion it cannot reach.
// test/helpers/fake-d1.js:3-5 makes the same argument about SQL.
//
// THE BUDGET, and where it grew. The plan (#21, R1) sized this at six operations: createElement,
// createTextNode, appendChild, setAttribute, className/classList.add and textContent. Two more
// are here, and each is bookkeeping rather than browser:
//
//   * `addEventListener` RECORDS the handler and never calls it. HelpLadder's rungs are the only
//     interactive thing in the ticket, public/*.js uses addEventListener everywhere and never a
//     handler property, and the rung test invokes the recorded function directly. Recording is
//     not dispatch: there is no event object, no bubbling and no default action.
//   * `hidden` is a plain property that `serialize` reads. In a real DOM it reflects to the
//     attribute, which is why clients.js sets the property and app.css:441-445 matches on
//     `[hidden]`; the panels have to carry it for the disclosure test to mean anything.
//
// A test that needs a NINTH capability — layout, focus, real dispatch, computed style, a
// selector engine — is a test about something this helper cannot honestly answer. Move it to the
// manual sweep rather than growing the file.
//
// `test/*.test.js` does not glob into `test/helpers/`, so this is never collected as a suite.

/** A text node. Kept as a plain tagged object: it has no behaviour worth modelling. */
const textNode = (value) => ({ type: "text", value: String(value) });

function element(tag) {
  const node = {
    type: "element",
    tag: String(tag),
    attrs: {},
    classes: [],
    children: [],
    /** Recorded, never dispatched. `node.listeners.click[0]()` is how a test reaches a handler. */
    listeners: {},
    hidden: false,

    appendChild(child) {
      node.children.push(child);
      return child;
    },
    setAttribute(name, value) {
      node.attrs[name] = String(value);
    },
    classList: {
      add(...names) {
        for (const name of names) if (name && !node.classes.includes(name)) node.classes.push(name);
      },
    },
    addEventListener(type, handler) {
      (node.listeners[type] ||= []).push(handler);
    },
  };

  Object.defineProperty(node, "className", {
    get: () => node.classes.join(" "),
    set: (value) => {
      node.classes = String(value).split(/\s+/).filter(Boolean);
    },
  });

  // An accessor pair, as the real thing is: the setter replaces every child with one text node
  // (which is what makes `mount.textContent = ""` a clear rather than an append), and the getter
  // concatenates the text of every descendant.
  Object.defineProperty(node, "textContent", {
    get: () => textOf(node),
    set: (value) => {
      node.children = String(value) ? [textNode(value)] : [];
    },
  });

  return node;
}

/** The document double. Two factory methods, which is all the registry ever asks a document for. */
export function fakeDocument() {
  return {
    createElement: (tag) => element(tag),
    createTextNode: (value) => textNode(value),
  };
}

/**
 * An HTML-shaped string of a subtree.
 *
 * ATTRIBUTES AND CLASS NAMES ARE INCLUDED DELIBERATELY. Two of the load-bearing assertions in
 * test/prep-registry.test.js are "this string appears nowhere in the output" — an unknown block
 * name, and a failed quote's text. A serializer that dropped attributes would let either of them
 * slip through a title, an aria-label or a data-* while both assertions still passed.
 */
export function serialize(node) {
  if (!node) return "";
  if (node.type === "text") return node.value;

  const attrs = [];
  if (node.classes.length) attrs.push(`class="${node.classes.join(" ")}"`);
  for (const [name, value] of Object.entries(node.attrs)) attrs.push(`${name}="${value}"`);
  if (node.hidden) attrs.push("hidden");

  const open = `<${node.tag}${attrs.length ? ` ${attrs.join(" ")}` : ""}>`;
  return `${open}${node.children.map(serialize).join("")}</${node.tag}>`;
}

/** Every descendant's text, concatenated. */
export function textOf(node) {
  if (!node) return "";
  if (node.type === "text") return node.value;
  return node.children.map(textOf).join("");
}

/** Every ELEMENT in the subtree the predicate accepts, the node itself included. */
export function findAll(node, predicate) {
  const found = [];
  const visit = (current) => {
    if (!current || current.type !== "element") return;
    if (predicate(current)) found.push(current);
    for (const child of current.children) visit(child);
  };
  visit(node);
  return found;
}
