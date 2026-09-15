// @ts-nocheck
// Extracted from the working VOT bundle supplied by the user.
// Self-contained parser/generator used to prepare YouTube player challenge code.
var e$1 = Object.defineProperty,
  t$1 = (t, n) => {
    const r = {};
    for (var i in t)
      e$1(r, i, {
        get: t[i],
        enumerable: !0,
      });
    return n || e$1(r, Symbol.toStringTag, { value: "Module" }), r;
  },
  n$1 = /* @__PURE__ */ t$1({
    EXPRESSIONS_PRECEDENCE: () => a$1,
    GENERATOR: () => ne,
    NEEDS_PARENTHESES: () => 17,
    baseGenerator: () => ie,
    generate: () => oe,
  }),
  { stringify: r$1 } = JSON;
/* c8 ignore if */
if (!String.prototype.repeat)
  /* c8 ignore next */
  throw Error(
    "String.prototype.repeat is undefined, see https://github.com/davidbonnet/astring#installation",
  );
/* c8 ignore if */
if (!String.prototype.endsWith)
  /* c8 ignore next */
  throw Error(
    "String.prototype.endsWith is undefined, see https://github.com/davidbonnet/astring#installation",
  );
var i$1 = {
  "||": 2,
  "??": 3,
  "&&": 4,
  "|": 5,
  "^": 6,
  "&": 7,
  "==": 8,
  "!=": 8,
  "===": 8,
  "!==": 8,
  "<": 9,
  ">": 9,
  "<=": 9,
  ">=": 9,
  in: 9,
  instanceof: 9,
  "<<": 10,
  ">>": 10,
  ">>>": 10,
  "+": 11,
  "-": 11,
  "*": 12,
  "%": 12,
  "/": 12,
  "**": 13,
};
var a$1 = {
  ArrayExpression: 20,
  TaggedTemplateExpression: 20,
  ThisExpression: 20,
  Identifier: 20,
  PrivateIdentifier: 20,
  Literal: 18,
  TemplateLiteral: 20,
  Super: 20,
  SequenceExpression: 20,
  MemberExpression: 19,
  ChainExpression: 19,
  CallExpression: 19,
  NewExpression: 19,
  ArrowFunctionExpression: 17,
  ClassExpression: 17,
  FunctionExpression: 17,
  ObjectExpression: 17,
  UpdateExpression: 16,
  UnaryExpression: 15,
  AwaitExpression: 15,
  BinaryExpression: 14,
  LogicalExpression: 13,
  ConditionalExpression: 4,
  AssignmentExpression: 3,
  YieldExpression: 2,
  RestElement: 1,
};
function o$1(e, t) {
  const { generator: n } = e;
  if ((e.write("("), t != null && t.length > 0)) {
    n[t[0].type](t[0], e);
    const { length: r } = t;
    for (let i = 1; i < r; i++) {
      const r = t[i];
      e.write(", "), n[r.type](r, e);
    }
  }
  e.write(")");
}
function s$1(e, t, n, r) {
  const a = e.expressionsPrecedence[t.type];
  if (a === 17) return !0;
  const o = e.expressionsPrecedence[n.type];
  return a === o
    ? a !== 13 && a !== 14
      ? !1
      : t.operator === "**" && n.operator === "**"
        ? !r
        : a === 13 && o === 13 && (t.operator === "??" || n.operator === "??")
          ? !0
          : r
            ? i$1[t.operator] <= i$1[n.operator]
            : i$1[t.operator] < i$1[n.operator]
    : (!r && a === 15 && o === 14 && n.operator === "**") || a < o;
}
function c$1(e, t, n, r) {
  const { generator: i } = e;
  s$1(e, t, n, r)
    ? (e.write("("), i[t.type](t, e), e.write(")"))
    : i[t.type](t, e);
}
function l$1(e, t, n, r) {
  const i = t.split("\n"),
    a = i.length - 1;
  if ((e.write(i[0].trim()), a > 0)) {
    e.write(r);
    for (let t = 1; t < a; t++) e.write(n + i[t].trim() + r);
    e.write(n + i[a].trim());
  }
}
function u$1(e, t, n, r) {
  const { length: i } = t;
  for (let a = 0; a < i; a++) {
    const i = t[a];
    e.write(n),
      i.type[0] === "L"
        ? e.write(`// ${i.value.trim()}\n`, i)
        : (e.write("/*"), l$1(e, i.value, n, r), e.write(`*/${r}`));
  }
}
function d$1(e) {
  let t = e;
  for (; t != null; ) {
    const { type: e } = t;
    if (e[0] === "C" && e[1] === "a") return !0;
    if (e[0] === "M" && e[1] === "e" && e[2] === "m") t = t.object;
    else return !1;
  }
}
function f$1(e, t) {
  const { generator: n } = e,
    { declarations: r } = t;
  e.write(`${t.kind} `);
  const { length: i } = r;
  if (i > 0) {
    n.VariableDeclarator(r[0], e);
    for (let t = 1; t < i; t++) e.write(", "), n.VariableDeclarator(r[t], e);
  }
}
var p$1;
var m$1;
var h$1;
var g$1;
var ee;
var te;
var ne = {
  Program(e, t) {
    const n = t.indent.repeat(t.indentLevel),
      { lineEnd: r, writeComments: i } = t;
    i && e.comments != null && u$1(t, e.comments, n, r);
    const a = e.body,
      { length: o } = a;
    for (let e = 0; e < o; e++) {
      const o = a[e];
      i && o.comments != null && u$1(t, o.comments, n, r),
        t.write(n),
        this[o.type](o, t),
        t.write(r);
    }
    i && e.trailingComments != null && u$1(t, e.trailingComments, n, r);
  },
  BlockStatement: (te = function (e, t) {
    const n = t.indent.repeat(t.indentLevel++),
      { lineEnd: r, writeComments: i } = t,
      a = n + t.indent;
    t.write("{");
    const o = e.body;
    if (o != null && o.length > 0) {
      t.write(r), i && e.comments != null && u$1(t, e.comments, a, r);
      const { length: s } = o;
      for (let e = 0; e < s; e++) {
        const n = o[e];
        i && n.comments != null && u$1(t, n.comments, a, r),
          t.write(a),
          this[n.type](n, t),
          t.write(r);
      }
      t.write(n);
    } else
      i &&
        e.comments != null &&
        (t.write(r), u$1(t, e.comments, a, r), t.write(n));
    i && e.trailingComments != null && u$1(t, e.trailingComments, a, r),
      t.write("}"),
      t.indentLevel--;
  }),
  ClassBody: te,
  StaticBlock(e, t) {
    t.write("static "), this.BlockStatement(e, t);
  },
  EmptyStatement(_e, t) {
    t.write(";");
  },
  ExpressionStatement(e, t) {
    const n = t.expressionsPrecedence[e.expression.type];
    n === 17 || (n === 3 && e.expression.left.type[0] === "O")
      ? (t.write("("), this[e.expression.type](e.expression, t), t.write(")"))
      : this[e.expression.type](e.expression, t),
      t.write(";");
  },
  IfStatement(e, t) {
    t.write("if ("),
      this[e.test.type](e.test, t),
      t.write(") "),
      this[e.consequent.type](e.consequent, t),
      e.alternate != null &&
        (t.write(" else "), this[e.alternate.type](e.alternate, t));
  },
  LabeledStatement(e, t) {
    this[e.label.type](e.label, t), t.write(": "), this[e.body.type](e.body, t);
  },
  BreakStatement(e, t) {
    t.write("break"),
      e.label != null && (t.write(" "), this[e.label.type](e.label, t)),
      t.write(";");
  },
  ContinueStatement(e, t) {
    t.write("continue"),
      e.label != null && (t.write(" "), this[e.label.type](e.label, t)),
      t.write(";");
  },
  WithStatement(e, t) {
    t.write("with ("),
      this[e.object.type](e.object, t),
      t.write(") "),
      this[e.body.type](e.body, t);
  },
  SwitchStatement(e, t) {
    const n = t.indent.repeat(t.indentLevel++),
      { lineEnd: r, writeComments: i } = t;
    t.indentLevel++;
    const a = n + t.indent,
      o = a + t.indent;
    t.write("switch ("),
      this[e.discriminant.type](e.discriminant, t),
      t.write(`) {${r}`);
    const { cases: s } = e,
      { length: c } = s;
    for (let e = 0; e < c; e++) {
      const n = s[e];
      i && n.comments != null && u$1(t, n.comments, a, r),
        n.test
          ? (t.write(`${a}case `),
            this[n.test.type](n.test, t),
            t.write(`:${r}`))
          : t.write(`${a}default:${r}`);
      const { consequent: c } = n,
        { length: l } = c;
      for (let e = 0; e < l; e++) {
        const n = c[e];
        i && n.comments != null && u$1(t, n.comments, o, r),
          t.write(o),
          this[n.type](n, t),
          t.write(r);
      }
    }
    (t.indentLevel -= 2), t.write(`${n}}`);
  },
  ReturnStatement(e, t) {
    t.write("return"),
      e.argument && (t.write(" "), this[e.argument.type](e.argument, t)),
      t.write(";");
  },
  ThrowStatement(e, t) {
    t.write("throw "), this[e.argument.type](e.argument, t), t.write(";");
  },
  TryStatement(e, t) {
    if ((t.write("try "), this[e.block.type](e.block, t), e.handler)) {
      const { handler: n } = e;
      n.param == null
        ? t.write(" catch ")
        : (t.write(" catch ("), this[n.param.type](n.param, t), t.write(") ")),
        this[n.body.type](n.body, t);
    }
    e.finalizer &&
      (t.write(" finally "), this[e.finalizer.type](e.finalizer, t));
  },
  WhileStatement(e, t) {
    t.write("while ("),
      this[e.test.type](e.test, t),
      t.write(") "),
      this[e.body.type](e.body, t);
  },
  DoWhileStatement(e, t) {
    t.write("do "),
      this[e.body.type](e.body, t),
      t.write(" while ("),
      this[e.test.type](e.test, t),
      t.write(");");
  },
  ForStatement(e, t) {
    if ((t.write("for ("), e.init != null)) {
      const { init: n } = e;
      n.type[0] === "V" ? f$1(t, n) : this[n.type](n, t);
    }
    t.write("; "),
      e.test && this[e.test.type](e.test, t),
      t.write("; "),
      e.update && this[e.update.type](e.update, t),
      t.write(") "),
      this[e.body.type](e.body, t);
  },
  ForInStatement: (p$1 = function (e, t) {
    t.write(`for ${e.await ? "await " : ""}(`);
    const { left: n } = e;
    n.type[0] === "V" ? f$1(t, n) : this[n.type](n, t),
      t.write(e.type[3] === "I" ? " in " : " of "),
      this[e.right.type](e.right, t),
      t.write(") "),
      this[e.body.type](e.body, t);
  }),
  ForOfStatement: p$1,
  DebuggerStatement(e, t) {
    t.write("debugger;", e);
  },
  FunctionDeclaration: (m$1 = function (e, t) {
    t.write(
      (e.async ? "async " : "") +
        (e.generator ? "function* " : "function ") +
        (e.id ? e.id.name : ""),
      e,
    ),
      o$1(t, e.params),
      t.write(" "),
      this[e.body.type](e.body, t);
  }),
  FunctionExpression: m$1,
  VariableDeclaration(e, t) {
    f$1(t, e), t.write(";");
  },
  VariableDeclarator(e, t) {
    this[e.id.type](e.id, t),
      e.init != null && (t.write(" = "), this[e.init.type](e.init, t));
  },
  ClassDeclaration(e, t) {
    if ((t.write(`class ${e.id ? `${e.id.name} ` : ""}`, e), e.superClass)) {
      t.write("extends ");
      const { superClass: n } = e,
        { type: r } = n,
        i = t.expressionsPrecedence[r];
      (r[0] !== "C" || r[1] !== "l" || r[5] !== "E") &&
      (i === 17 || i < t.expressionsPrecedence.ClassExpression)
        ? (t.write("("), this[e.superClass.type](n, t), t.write(")"))
        : this[n.type](n, t),
        t.write(" ");
    }
    this.ClassBody(e.body, t);
  },
  ImportDeclaration(e, t) {
    t.write("import ");
    let { specifiers: n, attributes: r } = e,
      { length: i } = n,
      a = 0;
    if (i > 0) {
      for (; a < i; ) {
        a > 0 && t.write(", ");
        const e = n[a],
          r = e.type[6];
        if (r === "D") t.write(e.local.name, e), a++;
        else if (r === "N") t.write(`* as ${e.local.name}`, e), a++;
        else break;
      }
      if (a < i) {
        for (t.write("{"); ; ) {
          const e = n[a],
            { name: r } = e.imported;
          if (
            (t.write(r, e),
            r !== e.local.name && t.write(` as ${e.local.name}`),
            ++a < i)
          )
            t.write(", ");
          else break;
        }
        t.write("}");
      }
      t.write(" from ");
    }
    if ((this.Literal(e.source, t), r && r.length > 0)) {
      t.write(" with { ");
      for (let e = 0; e < r.length; e++)
        this.ImportAttribute(r[e], t), e < r.length - 1 && t.write(", ");
      t.write(" }");
    }
    t.write(";");
  },
  ImportAttribute(e, t) {
    this.Identifier(e.key, t), t.write(": "), this.Literal(e.value, t);
  },
  ImportExpression(e, t) {
    t.write("import("), this[e.source.type](e.source, t), t.write(")");
  },
  ExportDefaultDeclaration(e, t) {
    t.write("export default "),
      this[e.declaration.type](e.declaration, t),
      t.expressionsPrecedence[e.declaration.type] != null &&
        e.declaration.type[0] !== "F" &&
        t.write(";");
  },
  ExportNamedDeclaration(e, t) {
    if ((t.write("export "), e.declaration))
      this[e.declaration.type](e.declaration, t);
    else {
      t.write("{");
      const { specifiers: n } = e,
        { length: r } = n;
      if (r > 0)
        for (let e = 0; ; ) {
          const i = n[e],
            { name: a } = i.local;
          if (
            (t.write(a, i),
            a !== i.exported.name && t.write(` as ${i.exported.name}`),
            ++e < r)
          )
            t.write(", ");
          else break;
        }
      if (
        (t.write("}"),
        e.source && (t.write(" from "), this.Literal(e.source, t)),
        e.attributes && e.attributes.length > 0)
      ) {
        t.write(" with { ");
        for (let n = 0; n < e.attributes.length; n++)
          this.ImportAttribute(e.attributes[n], t),
            n < e.attributes.length - 1 && t.write(", ");
        t.write(" }");
      }
      t.write(";");
    }
  },
  ExportAllDeclaration(e, t) {
    if (
      (e.exported == null
        ? t.write("export * from ")
        : t.write(`export * as ${e.exported.name} from `),
      this.Literal(e.source, t),
      e.attributes && e.attributes.length > 0)
    ) {
      t.write(" with { ");
      for (let n = 0; n < e.attributes.length; n++)
        this.ImportAttribute(e.attributes[n], t),
          n < e.attributes.length - 1 && t.write(", ");
      t.write(" }");
    }
    t.write(";");
  },
  MethodDefinition(e, t) {
    e.static && t.write("static ");
    const n = e.kind[0];
    (n === "g" || n === "s") && t.write(`${e.kind} `),
      e.value.async && t.write("async "),
      e.value.generator && t.write("*"),
      e.computed
        ? (t.write("["), this[e.key.type](e.key, t), t.write("]"))
        : this[e.key.type](e.key, t),
      o$1(t, e.value.params),
      t.write(" "),
      this[e.value.body.type](e.value.body, t);
  },
  ClassExpression(e, t) {
    this.ClassDeclaration(e, t);
  },
  ArrowFunctionExpression(e, t) {
    t.write(e.async ? "async " : "", e);
    const { params: n } = e;
    n != null &&
      (n.length === 1 && n[0].type[0] === "I"
        ? t.write(n[0].name, n[0])
        : o$1(t, e.params)),
      t.write(" => "),
      e.body.type[0] === "O"
        ? (t.write("("), this.ObjectExpression(e.body, t), t.write(")"))
        : this[e.body.type](e.body, t);
  },
  ThisExpression(e, t) {
    t.write("this", e);
  },
  Super(e, t) {
    t.write("super", e);
  },
  RestElement: (h$1 = function (e, t) {
    t.write("..."), this[e.argument.type](e.argument, t);
  }),
  SpreadElement: h$1,
  YieldExpression(e, t) {
    t.write(e.delegate ? "yield*" : "yield"),
      e.argument && (t.write(" "), this[e.argument.type](e.argument, t));
  },
  AwaitExpression(e, t) {
    t.write("await ", e), c$1(t, e.argument, e);
  },
  TemplateLiteral(e, t) {
    const { quasis: n, expressions: r } = e;
    t.write("`");
    const { length: i } = r;
    for (let e = 0; e < i; e++) {
      const i = r[e],
        a = n[e];
      t.write(a.value.raw, a), t.write("${"), this[i.type](i, t), t.write("}");
    }
    const a = n[n.length - 1];
    t.write(a.value.raw, a), t.write("`");
  },
  TemplateElement(e, t) {
    t.write(e.value.raw, e);
  },
  TaggedTemplateExpression(e, t) {
    c$1(t, e.tag, e), this[e.quasi.type](e.quasi, t);
  },
  ArrayExpression: (ee = function (e, t) {
    if ((t.write("["), e.elements.length > 0)) {
      const { elements: n } = e,
        { length: r } = n;
      for (let e = 0; ; ) {
        const i = n[e];
        if ((i != null && this[i.type](i, t), ++e < r)) t.write(", ");
        else {
          i ?? t.write(", ");
          break;
        }
      }
    }
    t.write("]");
  }),
  ArrayPattern: ee,
  ObjectExpression(e, t) {
    const n = t.indent.repeat(t.indentLevel++),
      { lineEnd: r, writeComments: i } = t,
      a = n + t.indent;
    if ((t.write("{"), e.properties.length > 0)) {
      t.write(r), i && e.comments != null && u$1(t, e.comments, a, r);
      const o = `,${r}`,
        { properties: s } = e,
        { length: c } = s;
      for (let e = 0; ; ) {
        const n = s[e];
        if (
          (i && n.comments != null && u$1(t, n.comments, a, r),
          t.write(a),
          this[n.type](n, t),
          ++e < c)
        )
          t.write(o);
        else break;
      }
      t.write(r),
        i && e.trailingComments != null && u$1(t, e.trailingComments, a, r),
        t.write(`${n}}`);
    } else
      i
        ? e.comments == null
          ? e.trailingComments == null
            ? t.write("}")
            : (t.write(r), u$1(t, e.trailingComments, a, r), t.write(`${n}}`))
          : (t.write(r),
            u$1(t, e.comments, a, r),
            e.trailingComments != null && u$1(t, e.trailingComments, a, r),
            t.write(`${n}}`))
        : t.write("}");
    t.indentLevel--;
  },
  Property(e, t) {
    e.method || e.kind[0] !== "i"
      ? this.MethodDefinition(e, t)
      : (e.shorthand ||
          (e.computed
            ? (t.write("["), this[e.key.type](e.key, t), t.write("]"))
            : this[e.key.type](e.key, t),
          t.write(": ")),
        this[e.value.type](e.value, t));
  },
  PropertyDefinition(e, t) {
    if (
      (e.static && t.write("static "),
      e.computed && t.write("["),
      this[e.key.type](e.key, t),
      e.computed && t.write("]"),
      e.value == null)
    ) {
      e.key.type[0] !== "F" && t.write(";");
      return;
    }
    t.write(" = "), this[e.value.type](e.value, t), t.write(";");
  },
  ObjectPattern(e, t) {
    if ((t.write("{"), e.properties.length > 0)) {
      const { properties: n } = e,
        { length: r } = n;
      for (let e = 0; this[n[e].type](n[e], t), ++e < r; ) t.write(", ");
    }
    t.write("}");
  },
  SequenceExpression(e, t) {
    o$1(t, e.expressions);
  },
  UnaryExpression(e, t) {
    if (e.prefix) {
      const {
        operator: n,
        argument: r,
        argument: { type: i },
      } = e;
      t.write(n);
      const a = s$1(t, r, e);
      !a &&
        (n.length > 1 ||
          (i[0] === "U" &&
            (i[1] === "n" || i[1] === "p") &&
            r.prefix &&
            r.operator[0] === n &&
            (n === "+" || n === "-"))) &&
        t.write(" "),
        a
          ? (t.write(n.length > 1 ? " (" : "("), this[i](r, t), t.write(")"))
          : this[i](r, t);
    } else this[e.argument.type](e.argument, t), t.write(e.operator);
  },
  UpdateExpression(e, t) {
    e.prefix
      ? (t.write(e.operator), this[e.argument.type](e.argument, t))
      : (this[e.argument.type](e.argument, t), t.write(e.operator));
  },
  AssignmentExpression(e, t) {
    this[e.left.type](e.left, t),
      t.write(` ${e.operator} `),
      this[e.right.type](e.right, t);
  },
  AssignmentPattern(e, t) {
    this[e.left.type](e.left, t),
      t.write(" = "),
      this[e.right.type](e.right, t);
  },
  BinaryExpression: (g$1 = (e, t) => {
    const n = e.operator === "in";
    n && t.write("("),
      c$1(t, e.left, e, !1),
      t.write(` ${e.operator} `),
      c$1(t, e.right, e, !0),
      n && t.write(")");
  }),
  LogicalExpression: g$1,
  ConditionalExpression(e, t) {
    const { test: n } = e,
      r = t.expressionsPrecedence[n.type];
    r === 17 || r <= t.expressionsPrecedence.ConditionalExpression
      ? (t.write("("), this[n.type](n, t), t.write(")"))
      : this[n.type](n, t),
      t.write(" ? "),
      this[e.consequent.type](e.consequent, t),
      t.write(" : "),
      this[e.alternate.type](e.alternate, t);
  },
  NewExpression(e, t) {
    t.write("new ");
    const n = t.expressionsPrecedence[e.callee.type];
    n === 17 || n < t.expressionsPrecedence.CallExpression || d$1(e.callee)
      ? (t.write("("), this[e.callee.type](e.callee, t), t.write(")"))
      : this[e.callee.type](e.callee, t),
      o$1(t, e.arguments);
  },
  CallExpression(e, t) {
    const n = t.expressionsPrecedence[e.callee.type];
    n === 17 || n < t.expressionsPrecedence.CallExpression
      ? (t.write("("), this[e.callee.type](e.callee, t), t.write(")"))
      : this[e.callee.type](e.callee, t),
      e.optional && t.write("?."),
      o$1(t, e.arguments);
  },
  ChainExpression(e, t) {
    this[e.expression.type](e.expression, t);
  },
  MemberExpression(e, t) {
    const n = t.expressionsPrecedence[e.object.type];
    n === 17 || n < t.expressionsPrecedence.MemberExpression
      ? (t.write("("), this[e.object.type](e.object, t), t.write(")"))
      : this[e.object.type](e.object, t),
      e.computed
        ? (e.optional && t.write("?."),
          t.write("["),
          this[e.property.type](e.property, t),
          t.write("]"))
        : (e.optional ? t.write("?.") : t.write("."),
          this[e.property.type](e.property, t));
  },
  MetaProperty(e, t) {
    t.write(`${e.meta.name}.${e.property.name}`, e);
  },
  Identifier(e, t) {
    t.write(e.name, e);
  },
  PrivateIdentifier(e, t) {
    t.write(`#${e.name}`, e);
  },
  Literal(e, t) {
    e.raw == null
      ? e.regex == null
        ? e.bigint == null
          ? t.write(r$1(e.value), e)
          : t.write(`${e.bigint}n`, e)
        : this.RegExpLiteral(e, t)
      : t.write(e.raw, e);
  },
  RegExpLiteral(e, t) {
    const { regex: n } = e;
    t.write(`/${n.pattern}/${n.flags}`, e);
  },
};
var re = {};
var ie = ne;
var ae = class {
  constructor(e) {
    const t = e ?? re;
    (this.output = ""),
      t.output == null
        ? (this.output = "")
        : ((this.output = t.output), (this.write = this.writeToStream)),
      (this.generator = t.generator == null ? ne : t.generator),
      (this.expressionsPrecedence =
        t.expressionsPrecedence == null ? a$1 : t.expressionsPrecedence),
      (this.indent = t.indent == null ? "  " : t.indent),
      (this.lineEnd = t.lineEnd == null ? "\n" : t.lineEnd),
      (this.indentLevel =
        t.startingIndentLevel == null ? 0 : t.startingIndentLevel),
      (this.writeComments = t.comments ? t.comments : !1),
      t.sourceMap != null &&
        ((this.write =
          t.output == null ? this.writeAndMap : this.writeToStreamAndMap),
        (this.sourceMap = t.sourceMap),
        (this.line = 1),
        (this.column = 0),
        (this.lineEndSize = this.lineEnd.split("\n").length - 1),
        (this.mapping = {
          original: null,
          generated: this,
          name: void 0,
          source: t.sourceMap.file || t.sourceMap._file,
        }));
  }
  write(e) {
    this.output += e;
  }
  writeToStream(e) {
    this.output.write(e);
  }
  writeAndMap(e, t) {
    (this.output += e), this.map(e, t);
  }
  writeToStreamAndMap(e, t) {
    this.output.write(e), this.map(e, t);
  }
  map(e, t) {
    if (t != null) {
      const { type: n } = t;
      if (n[0] === "L" && n[2] === "n") {
        (this.column = 0), this.line++;
        return;
      }
      if (t.loc != null) {
        const { mapping: e } = this;
        (e.original = t.loc.start),
          (e.name = t.name),
          this.sourceMap.addMapping(e);
      }
      if (
        (n[0] === "T" && n[8] === "E") ||
        (n[0] === "L" && n[1] === "i" && typeof t.value === "string")
      ) {
        let { length: t } = e,
          { column: n, line: r } = this;
        for (let i = 0; i < t; i++) e[i] === "\n" ? ((n = 0), r++) : n++;
        (this.column = n), (this.line = r);
        return;
      }
    }
    const { length: n } = e,
      { lineEnd: r } = this;
    n > 0 &&
      (this.lineEndSize > 0 && (r.length === 1 ? e[n - 1] === r : e.endsWith(r))
        ? ((this.line += this.lineEndSize), (this.column = 0))
        : (this.column += n));
  }
  toString() {
    return this.output;
  }
};
function oe(e, t) {
  const n = new ae(t);
  return n.generator[e.type](e, n), n.output;
}
var se = /* @__PURE__ */ t$1({
  parse: () => Sr,
  parseModule: () => xr,
  parseScript: () => br,
  version: () => yr,
});
var ce = ((e, t) => {
  let n = /* @__PURE__ */ new Uint32Array(69632),
    r = 0,
    i = 0;
  for (; r < 2571; ) {
    const a = e[r++];
    if (a < 0) i -= a;
    else {
      let o = e[r++];
      a & 2 && (o = t[o]), a & 1 ? n.fill(o, i, (i += e[r++])) : (n[i++] = o);
    }
  }
  return n;
})(
  [
    -1, 2, 26, 2, 27, 2, 5, -1, 0, 77595648, 3, 44, 2, 3, 0, 14, 2, 63, 2, 64,
    3, 0, 3, 0, 3168796671, 0, 4294956992, 2, 1, 2, 0, 2, 41, 3, 0, 4, 0,
    4294966523, 3, 0, 4, 2, 16, 2, 65, 2, 0, 0, 4294836735, 0, 3221225471, 0,
    4294901942, 2, 66, 0, 134152192, 3, 0, 2, 0, 4294951935, 3, 0, 2, 0,
    2683305983, 0, 2684354047, 2, 18, 2, 0, 0, 4294961151, 3, 0, 2, 2, 19, 2, 0,
    0, 608174079, 2, 0, 2, 60, 2, 7, 2, 6, 0, 4286611199, 3, 0, 2, 2, 1, 3, 0,
    3, 0, 4294901711, 2, 40, 0, 4089839103, 0, 2961209759, 0, 1342439375, 0,
    4294543342, 0, 3547201023, 0, 1577204103, 0, 4194240, 0, 4294688750, 2, 2,
    0, 80831, 0, 4261478351, 0, 4294549486, 2, 2, 0, 2967484831, 0, 196559, 0,
    3594373100, 0, 3288319768, 0, 8469959, 0, 65472, 2, 3, 0, 4093640191, 0,
    660618719, 0, 65487, 0, 4294828015, 0, 4092591615, 0, 1616920031, 0, 982991,
    2, 3, 2, 0, 0, 2163244511, 0, 4227923919, 0, 4236247022, 2, 71, 0,
    4284449919, 0, 851904, 2, 4, 2, 12, 0, 67076095, -1, 2, 72, 0, 1073741743,
    0, 4093607775, -1, 0, 50331649, 0, 3265266687, 2, 33, 0, 4294844415, 0,
    4278190047, 2, 20, 2, 137, -1, 3, 0, 2, 2, 23, 2, 0, 2, 10, 2, 0, 2, 15, 2,
    22, 3, 0, 10, 2, 74, 2, 0, 2, 75, 2, 76, 2, 77, 2, 0, 2, 78, 2, 0, 2, 11, 0,
    261632, 2, 25, 3, 0, 2, 2, 13, 2, 4, 3, 0, 18, 2, 79, 2, 5, 3, 0, 2, 2, 80,
    0, 2151677951, 2, 29, 2, 9, 0, 909311, 3, 0, 2, 0, 814743551, 2, 49, 0,
    67090432, 3, 0, 2, 2, 42, 2, 0, 2, 6, 2, 0, 2, 30, 2, 8, 0, 268374015, 2,
    110, 2, 51, 2, 0, 2, 81, 0, 134153215, -1, 2, 7, 2, 0, 2, 8, 0, 2684354559,
    0, 67044351, 0, 3221160064, 2, 17, -1, 3, 0, 2, 2, 53, 0, 1046528, 3, 0, 3,
    2, 9, 2, 0, 2, 54, 0, 4294960127, 2, 10, 2, 6, 2, 11, 0, 4294377472, 2, 12,
    3, 0, 16, 2, 13, 2, 0, 2, 82, 2, 10, 2, 0, 2, 83, 2, 84, 2, 85, 0, 12288, 2,
    55, 0, 1048577, 2, 86, 2, 14, -1, 2, 14, 0, 131042, 2, 87, 2, 88, 2, 89, 2,
    0, 2, 34, -83, 3, 0, 7, 0, 1046559, 2, 0, 2, 15, 2, 0, 0, 2147516671, 2, 21,
    3, 90, 2, 2, 0, -16, 2, 91, 0, 524222462, 2, 4, 2, 0, 0, 4269801471, 2, 4,
    3, 0, 2, 2, 28, 2, 16, 3, 0, 2, 2, 17, 2, 0, -1, 2, 18, -16, 3, 0, 206, -2,
    3, 0, 692, 2, 73, -1, 2, 18, 2, 10, 3, 0, 8, 2, 93, 2, 133, 2, 0, 0,
    3220242431, 3, 0, 3, 2, 19, 2, 94, 2, 95, 3, 0, 2, 2, 96, 2, 0, 2, 97, 2,
    46, 2, 0, 0, 4351, 2, 0, 2, 9, 3, 0, 2, 0, 67043391, 0, 3909091327, 2, 0, 2,
    24, 2, 9, 2, 20, 3, 0, 2, 0, 67076097, 2, 8, 2, 0, 2, 21, 0, 67059711, 0,
    4236247039, 3, 0, 2, 0, 939524103, 0, 8191999, 2, 101, 2, 102, 2, 22, 2, 23,
    3, 0, 3, 0, 67057663, 3, 0, 349, 2, 103, 2, 104, 2, 7, -264, 3, 0, 11, 2,
    24, 3, 0, 2, 2, 32, -1, 0, 3774349439, 2, 105, 2, 106, 3, 0, 2, 2, 19, 2,
    107, 3, 0, 10, 2, 10, 2, 18, 2, 0, 2, 47, 2, 0, 2, 31, 2, 108, 2, 25, 0,
    1638399, 0, 57344, 2, 109, 3, 0, 3, 2, 20, 2, 26, 2, 27, 2, 5, 2, 28, 2, 0,
    2, 8, 2, 111, -1, 2, 112, 2, 113, 2, 114, -1, 3, 0, 3, 2, 12, -2, 2, 0, 2,
    29, -3, 0, 536870912, -4, 2, 20, 2, 0, 2, 36, 0, 1, 2, 0, 2, 67, 2, 6, 2,
    12, 2, 10, 2, 0, 2, 115, -1, 3, 0, 4, 2, 10, 2, 23, 2, 116, 2, 7, 2, 0, 2,
    117, 2, 0, 2, 118, 2, 119, 2, 120, 2, 0, 2, 9, 3, 0, 9, 2, 21, 2, 30, 2, 31,
    2, 121, 2, 122, -2, 2, 123, 2, 124, 2, 30, 2, 21, 2, 8, -2, 2, 125, 2, 30,
    2, 32, -2, 2, 0, 2, 39, -2, 0, 4277137519, 0, 2269118463, -1, 3, 20, 2, -1,
    2, 33, 2, 38, 2, 0, 3, 30, 2, 2, 35, 2, 19, -3, 3, 0, 2, 2, 34, -1, 2, 0, 2,
    35, 2, 0, 2, 35, 2, 0, 2, 48, 2, 0, 0, 4294950463, 2, 37, -7, 2, 0, 0,
    203775, 2, 57, 0, 4026531840, 2, 20, 2, 43, 2, 36, 2, 18, 2, 37, 2, 18, 2,
    126, 2, 21, 3, 0, 2, 2, 38, 0, 2151677888, 2, 0, 2, 12, 0, 4294901764, 2,
    144, 2, 0, 2, 58, 2, 56, 0, 5242879, 3, 0, 2, 0, 402644511, -1, 2, 128, 2,
    39, 0, 3, -1, 2, 129, 2, 130, 2, 0, 0, 67045375, 2, 40, 0, 4226678271, 0,
    3766565279, 0, 2039759, 2, 132, 2, 41, 0, 1046437, 0, 6, 3, 0, 2, 0,
    3288270847, 0, 3, 3, 0, 2, 0, 67043519, -5, 2, 0, 0, 4282384383, 0,
    1056964609, -1, 3, 0, 2, 0, 67043345, -1, 2, 0, 2, 42, 2, 23, 2, 50, 2, 11,
    2, 61, 2, 38, -5, 2, 0, 2, 12, -3, 3, 0, 2, 0, 2147484671, 2, 134, 0,
    4190109695, 2, 52, -2, 2, 135, 0, 4244635647, 0, 27, 2, 0, 2, 8, 2, 43, 2,
    0, 2, 68, 2, 18, 2, 0, 2, 42, -6, 2, 0, 2, 45, 2, 59, 2, 44, 2, 45, 2, 46,
    2, 47, 0, 8388351, -2, 2, 136, 0, 3028287487, 2, 48, 2, 138, 0, 33259519, 2,
    49, -9, 2, 21, 0, 4294836223, 0, 3355443199, 0, 134152199, -2, 2, 69, -2, 3,
    0, 28, 2, 32, -3, 3, 0, 3, 2, 17, 3, 0, 6, 2, 50, -81, 2, 18, 3, 0, 2, 2,
    36, 3, 0, 33, 2, 25, 2, 30, 3, 0, 124, 2, 12, 3, 0, 18, 2, 38, -213, 2, 0,
    2, 32, -54, 3, 0, 17, 2, 42, 2, 8, 2, 23, 2, 0, 2, 8, 2, 23, 2, 51, 2, 0, 2,
    21, 2, 52, 2, 139, 2, 25, -13, 2, 0, 2, 53, -6, 3, 0, 2, -4, 3, 0, 2, 0,
    4294936575, 2, 0, 0, 4294934783, -2, 0, 196635, 3, 0, 191, 2, 54, 3, 0, 38,
    2, 30, 2, 55, 2, 34, -278, 2, 140, 3, 0, 9, 2, 141, 2, 142, 2, 56, 3, 0, 11,
    2, 7, -72, 3, 0, 3, 2, 143, 0, 1677656575, -130, 2, 26, -16, 2, 0, 2, 24, 2,
    38, -16, 0, 4161266656, 0, 4071, 0, 15360, -4, 2, 57, -13, 3, 0, 2, 2, 58,
    2, 0, 2, 145, 2, 146, 2, 62, 2, 0, 2, 147, 2, 148, 2, 149, 3, 0, 10, 2, 150,
    2, 151, 2, 22, 3, 58, 2, 3, 152, 2, 3, 59, 2, 0, 4294954999, 2, 0, -16, 2,
    0, 2, 92, 2, 0, 0, 2105343, 0, 4160749584, 0, 65534, -34, 2, 8, 2, 154, -6,
    0, 4194303871, 0, 4294903771, 2, 0, 2, 60, 2, 100, -3, 2, 0, 0, 1073684479,
    0, 17407, -9, 2, 18, 2, 17, 2, 0, 2, 32, -14, 2, 18, 2, 32, -6, 2, 18, 2,
    12, -15, 2, 155, 3, 0, 6, 0, 8323103, -1, 3, 0, 2, 2, 61, -37, 2, 62, 2,
    156, 2, 157, 2, 158, 2, 159, 2, 160, -105, 2, 26, -32, 3, 0, 1335, -1, 3, 0,
    129, 2, 32, 3, 0, 6, 2, 10, 3, 0, 180, 2, 161, 3, 0, 233, 2, 162, 3, 0, 18,
    2, 10, -77, 3, 0, 16, 2, 10, -47, 3, 0, 154, 2, 6, 3, 0, 130, 2, 25, -22250,
    3, 0, 7, 2, 25, -6130, 3, 5, 2, -1, 0, 69207040, 3, 44, 2, 3, 0, 14, 2, 63,
    2, 64, -3, 0, 3168731136, 0, 4294956864, 2, 1, 2, 0, 2, 41, 3, 0, 4, 0,
    4294966275, 3, 0, 4, 2, 16, 2, 65, 2, 0, 2, 34, -1, 2, 18, 2, 66, -1, 2, 0,
    0, 2047, 0, 4294885376, 3, 0, 2, 0, 3145727, 0, 2617294944, 0, 4294770688,
    2, 25, 2, 67, 3, 0, 2, 0, 131135, 2, 98, 0, 70256639, 0, 71303167, 0, 272,
    2, 42, 2, 6, 0, 32511, 2, 0, 2, 49, -1, 2, 99, 2, 68, 0, 4278255616, 0,
    4294836227, 0, 4294549473, 0, 600178175, 0, 2952806400, 0, 268632067, 0,
    4294543328, 0, 57540095, 0, 1577058304, 0, 1835008, 0, 4294688736, 2, 70, 2,
    69, 0, 33554435, 2, 131, 2, 70, 0, 2952790016, 0, 131075, 0, 3594373096, 0,
    67094296, 2, 69, -1, 0, 4294828e3, 0, 603979263, 0, 654311424, 0, 3, 0,
    4294828001, 0, 602930687, 0, 1610612736, 0, 393219, 0, 4294828016, 0,
    671088639, 0, 2154840064, 0, 4227858435, 0, 4236247008, 2, 71, 2, 38, -1, 2,
    4, 0, 917503, 2, 38, -1, 2, 72, 0, 537788335, 0, 4026531935, -1, 0, 1, -1,
    2, 33, 2, 73, 0, 7936, -3, 2, 0, 0, 2147485695, 0, 1010761728, 0,
    4292984930, 0, 16387, 2, 0, 2, 15, 2, 22, 3, 0, 10, 2, 74, 2, 0, 2, 75, 2,
    76, 2, 77, 2, 0, 2, 78, 2, 0, 2, 12, -1, 2, 25, 3, 0, 2, 2, 13, 2, 4, 3, 0,
    18, 2, 79, 2, 5, 3, 0, 2, 2, 80, 0, 2147745791, 3, 19, 2, 0, 122879, 2, 0,
    2, 9, 0, 276824064, -2, 3, 0, 2, 2, 42, 2, 0, 0, 4294903295, 2, 0, 2, 30, 2,
    8, -1, 2, 18, 2, 51, 2, 0, 2, 81, 2, 49, -1, 2, 21, 2, 0, 2, 29, -2, 0, 128,
    -2, 2, 28, 2, 9, 0, 8160, -1, 2, 127, 0, 4227907585, 2, 0, 2, 37, 2, 0, 2,
    50, 0, 4227915776, 2, 10, 2, 6, 2, 11, -1, 0, 74440192, 3, 0, 6, -2, 3, 0,
    8, 2, 13, 2, 0, 2, 82, 2, 10, 2, 0, 2, 83, 2, 84, 2, 85, -3, 2, 86, 2, 14,
    -3, 2, 87, 2, 88, 2, 89, 2, 0, 2, 34, -83, 3, 0, 7, 0, 817183, 2, 0, 2, 15,
    2, 0, 0, 33023, 2, 21, 3, 90, 2, -17, 2, 91, 0, 524157950, 2, 4, 2, 0, 2,
    92, 2, 4, 2, 0, 2, 22, 2, 28, 2, 16, 3, 0, 2, 2, 17, 2, 0, -1, 2, 18, -16,
    3, 0, 206, -2, 3, 0, 692, 2, 73, -1, 2, 18, 2, 10, 3, 0, 8, 2, 93, 0, 3072,
    2, 0, 0, 2147516415, 2, 10, 3, 0, 2, 2, 25, 2, 94, 2, 95, 3, 0, 2, 2, 96, 2,
    0, 2, 97, 2, 46, 0, 4294965179, 0, 7, 2, 0, 2, 9, 2, 95, 2, 9, -1, 0,
    1761345536, 2, 98, 0, 4294901823, 2, 38, 2, 20, 2, 99, 2, 35, 2, 100, 0,
    2080440287, 2, 0, 2, 34, 2, 153, 0, 3296722943, 2, 0, 0, 1046675455, 0,
    939524101, 0, 1837055, 2, 101, 2, 102, 2, 22, 2, 23, 3, 0, 3, 0, 7, 3, 0,
    349, 2, 103, 2, 104, 2, 7, -264, 3, 0, 11, 2, 24, 3, 0, 2, 2, 32, -1, 0,
    2700607615, 2, 105, 2, 106, 3, 0, 2, 2, 19, 2, 107, 3, 0, 10, 2, 10, 2, 18,
    2, 0, 2, 47, 2, 0, 2, 31, 2, 108, -3, 2, 109, 3, 0, 3, 2, 20, -1, 3, 5, 2,
    2, 110, 2, 0, 2, 8, 2, 111, -1, 2, 112, 2, 113, 2, 114, -1, 3, 0, 3, 2, 12,
    -2, 2, 0, 2, 29, -8, 2, 20, 2, 0, 2, 36, -1, 2, 0, 2, 67, 2, 6, 2, 30, 2,
    10, 2, 0, 2, 115, -1, 3, 0, 4, 2, 10, 2, 18, 2, 116, 2, 7, 2, 0, 2, 117, 2,
    0, 2, 118, 2, 119, 2, 120, 2, 0, 2, 9, 3, 0, 9, 2, 21, 2, 30, 2, 31, 2, 121,
    2, 122, -2, 2, 123, 2, 124, 2, 30, 2, 21, 2, 8, -2, 2, 125, 2, 30, 2, 32,
    -2, 2, 0, 2, 39, -2, 0, 4277075969, 2, 30, -1, 3, 20, 2, -1, 2, 33, 2, 126,
    2, 0, 3, 30, 2, 2, 35, 2, 19, -3, 3, 0, 2, 2, 34, -1, 2, 0, 2, 35, 2, 0, 2,
    35, 2, 0, 2, 50, 2, 98, 0, 4294934591, 2, 37, -7, 2, 0, 0, 197631, 2, 57,
    -1, 2, 20, 2, 43, 2, 37, 2, 18, 0, 3, 2, 18, 2, 126, 2, 21, 2, 127, 2, 54,
    -1, 0, 2490368, 2, 127, 2, 25, 2, 18, 2, 34, 2, 127, 2, 38, 0, 4294901904,
    0, 4718591, 2, 127, 2, 35, 0, 335544350, -1, 2, 128, 0, 2147487743, 0, 1,
    -1, 2, 129, 2, 130, 2, 8, -1, 2, 131, 2, 70, 0, 3758161920, 0, 3, 2, 132, 0,
    12582911, 0, 655360, -1, 2, 0, 2, 29, 0, 2147485568, 0, 3, 2, 0, 2, 25, 0,
    176, -5, 2, 0, 2, 17, 0, 251658240, -1, 2, 0, 2, 25, 0, 16, -1, 2, 0, 0,
    16779263, -2, 2, 12, -1, 2, 38, -5, 2, 0, 2, 133, -3, 3, 0, 2, 2, 55, 2,
    134, 0, 2147549183, 0, 2, -2, 2, 135, 2, 36, 0, 10, 0, 4294965249, 0,
    67633151, 0, 4026597376, 2, 0, 0, 536871935, 2, 18, 2, 0, 2, 42, -6, 2, 0,
    0, 1, 2, 59, 2, 17, 0, 1, 2, 46, 2, 25, -3, 2, 136, 2, 36, 2, 137, 2, 138,
    0, 16778239, -10, 2, 35, 0, 4294836212, 2, 9, -3, 2, 69, -2, 3, 0, 28, 2,
    32, -3, 3, 0, 3, 2, 17, 3, 0, 6, 2, 50, -81, 2, 18, 3, 0, 2, 2, 36, 3, 0,
    33, 2, 25, 0, 126, 3, 0, 124, 2, 12, 3, 0, 18, 2, 38, -213, 2, 10, -55, 3,
    0, 17, 2, 42, 2, 8, 2, 18, 2, 0, 2, 8, 2, 18, 2, 60, 2, 0, 2, 25, 2, 50, 2,
    139, 2, 25, -13, 2, 0, 2, 73, -6, 3, 0, 2, -4, 3, 0, 2, 0, 67583, -1, 2,
    107, -2, 0, 11, 3, 0, 191, 2, 54, 3, 0, 38, 2, 30, 2, 55, 2, 34, -278, 2,
    140, 3, 0, 9, 2, 141, 2, 142, 2, 56, 3, 0, 11, 2, 7, -72, 3, 0, 3, 2, 143,
    2, 144, -187, 3, 0, 2, 2, 58, 2, 0, 2, 145, 2, 146, 2, 62, 2, 0, 2, 147, 2,
    148, 2, 149, 3, 0, 10, 2, 150, 2, 151, 2, 22, 3, 58, 2, 3, 152, 2, 3, 59, 2,
    2, 153, -57, 2, 8, 2, 154, -7, 2, 18, 2, 0, 2, 60, -4, 2, 0, 0, 1065361407,
    0, 16384, -9, 2, 18, 2, 60, 2, 0, 2, 133, -14, 2, 18, 2, 133, -6, 2, 18, 0,
    81919, -15, 2, 155, 3, 0, 6, 2, 126, -1, 3, 0, 2, 0, 2063, -37, 2, 62, 2,
    156, 2, 157, 2, 158, 2, 159, 2, 160, -138, 3, 0, 1335, -1, 3, 0, 129, 2, 32,
    3, 0, 6, 2, 10, 3, 0, 180, 2, 161, 3, 0, 233, 2, 162, 3, 0, 18, 2, 10, -77,
    3, 0, 16, 2, 10, -47, 3, 0, 154, 2, 6, 3, 0, 130, 2, 25, -28386,
  ],
  [
    4294967295, 4294967291, 4092460543, 4294828031, 4294967294, 134217726,
    4294903807, 268435455, 2147483647, 1048575, 1073741823, 3892314111,
    134217727, 1061158911, 536805376, 4294910143, 4294901759, 32767, 4294901760,
    262143, 536870911, 8388607, 4160749567, 4294902783, 4294918143, 65535,
    67043328, 2281701374, 4294967264, 2097151, 4194303, 255, 67108863,
    4294967039, 511, 524287, 131071, 63, 127, 3238002687, 4294549487,
    4290772991, 33554431, 4294901888, 4286578687, 67043329, 4294705152,
    4294770687, 67043583, 1023, 15, 2047999, 67043343, 67051519, 16777215,
    2147483648, 4294902e3, 28, 4292870143, 4294966783, 16383, 67047423,
    4294967279, 262083, 20511, 41943039, 493567, 4294959104, 603979775, 65536,
    602799615, 805044223, 4294965206, 8191, 1031749119, 4294917631, 2134769663,
    4286578493, 4282253311, 4294942719, 33540095, 4294905855, 2868854591,
    1608515583, 265232348, 534519807, 2147614720, 1060109444, 4093640016, 17376,
    2139062143, 224, 4169138175, 4294909951, 4286578688, 4294967292, 4294965759,
    535511039, 4294966272, 4294967280, 32768, 8289918, 4294934399, 4294901775,
    4294965375, 1602223615, 4294967259, 4294443008, 268369920, 4292804608,
    4294967232, 486341884, 4294963199, 3087007615, 1073692671, 4128527,
    4279238655, 4294902015, 4160684047, 4290246655, 469499899, 4294967231,
    134086655, 4294966591, 2445279231, 3670015, 31, 4294967288, 4294705151,
    3221208447, 4294902271, 4294549472, 4294921215, 4095, 4285526655,
    4294966527, 4294966143, 64, 4294966719, 3774873592, 1877934080, 262151,
    2555904, 536807423, 67043839, 3758096383, 3959414372, 3755993023,
    2080374783, 4294835295, 4294967103, 4160749565, 4294934527, 4087, 2016,
    2147446655, 184024726, 2862017156, 1593309078, 268434431, 268434414,
    4294901763, 4294901761,
  ],
);
var le = (e) => !!((ce[(e >>> 5) + 0] >>> e) & 1);
var ue = (e) => !!((ce[(e >>> 5) + 34816] >>> e) & 1);
function _$1(e) {
  return e.column++, (e.currentChar = e.source.charCodeAt(++e.index));
}
function de(e) {
  const t = e.currentChar;
  if ((t & 64512) !== 55296) return 0;
  const n = e.source.charCodeAt(e.index + 1);
  return (n & 64512) === 56320 ? 65536 + ((t & 1023) << 10) + (n & 1023) : 0;
}
function fe(e, t) {
  (e.currentChar = e.source.charCodeAt(++e.index)),
    (e.flags |= 1),
    t & 4 || ((e.column = 0), e.line++);
}
function v$1(e) {
  (e.flags |= 1),
    (e.currentChar = e.source.charCodeAt(++e.index)),
    (e.column = 0),
    e.line++;
}
function pe(e) {
  return (
    e === 160 ||
    e === 65279 ||
    e === 133 ||
    e === 5760 ||
    (e >= 8192 && e <= 8203) ||
    e === 8239 ||
    e === 8287 ||
    e === 12288 ||
    e === 8201 ||
    e === 65519
  );
}
function y$1(e) {
  return e < 65 ? e - 48 : (e - 65 + 10) & 15;
}
function me(e) {
  switch (e) {
    case 134283266:
      return "NumericLiteral";
    case 134283267:
      return "StringLiteral";
    case 86021:
    case 86022:
      return "BooleanLiteral";
    case 86023:
      return "NullLiteral";
    case 65540:
      return "RegularExpression";
    case 67174408:
    case 67174409:
    case 131:
      return "TemplateLiteral";
    default:
      return (e & 143360) === 143360
        ? "Identifier"
        : (e & 4096) === 4096
          ? "Keyword"
          : "Punctuator";
  }
}
var b$1 = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1032, 0, 0, 2056, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 8192, 0, 3, 0, 0, 8192, 0, 0, 0, 256, 0, 33024,
  0, 0, 242, 242, 114, 114, 114, 114, 114, 114, 594, 594, 0, 0, 16384, 0, 0, 0,
  0, 67, 67, 67, 67, 67, 67, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
  3, 3, 3, 0, 1, 0, 0, 4099, 0, 71, 71, 71, 71, 71, 71, 7, 7, 7, 7, 7, 7, 7, 7,
  7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 16384, 0, 0, 0, 0,
];
var he = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0,
];
var ge = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0,
];
function _e(e) {
  return e <= 127 ? he[e] > 0 : ue(e);
}
function ve(e) {
  return e <= 127 ? ge[e] > 0 : le(e) || e === 8204 || e === 8205;
}
var ye = [
  "SingleLine",
  "MultiLine",
  "HTMLOpen",
  "HTMLClose",
  "HashbangComment",
];
function be(e) {
  const { source: t } = e;
  e.currentChar === 35 &&
    t.charCodeAt(e.index + 1) === 33 &&
    (_$1(e), _$1(e), Se(e, t, 0, 4, e.tokenStart));
}
function xe(e, t, n, r, i, a) {
  return r & 2 && e.report(0), Se(e, t, n, i, a);
}
function Se(e, t, n, r, i) {
  const { index: a } = e;
  for (
    e.tokenIndex = e.index, e.tokenLine = e.line, e.tokenColumn = e.column;
    e.index < e.end;
  ) {
    if (b$1[e.currentChar] & 8) {
      const n = e.currentChar === 13;
      v$1(e),
        n &&
          e.index < e.end &&
          e.currentChar === 10 &&
          (e.currentChar = t.charCodeAt(++e.index));
      break;
    }
    if ((e.currentChar ^ 8232) <= 1) {
      v$1(e);
      break;
    }
    _$1(e),
      (e.tokenIndex = e.index),
      (e.tokenLine = e.line),
      (e.tokenColumn = e.column);
  }
  if (e.options.onComment) {
    const n = {
      start: {
        line: i.line,
        column: i.column,
      },
      end: {
        line: e.tokenLine,
        column: e.tokenColumn,
      },
    };
    e.options.onComment(
      ye[r & 255],
      t.slice(a, e.tokenIndex),
      i.index,
      e.tokenIndex,
      n,
    );
  }
  return n | 1;
}
function Ce(e, t, n) {
  const { index: r } = e;
  for (; e.index < e.end; )
    if (e.currentChar < 43) {
      let i = !1;
      for (; e.currentChar === 42; )
        if (((i ||= ((n &= -5), !0)), _$1(e) === 47)) {
          if ((_$1(e), e.options.onComment)) {
            const n = {
              start: {
                line: e.tokenLine,
                column: e.tokenColumn,
              },
              end: {
                line: e.line,
                column: e.column,
              },
            };
            e.options.onComment(
              ye[1],
              t.slice(r, e.index - 2),
              r - 2,
              e.index,
              n,
            );
          }
          return (
            (e.tokenIndex = e.index),
            (e.tokenLine = e.line),
            (e.tokenColumn = e.column),
            n
          );
        }
      if (i) continue;
      b$1[e.currentChar] & 8
        ? e.currentChar === 13
          ? ((n |= 5), v$1(e))
          : (fe(e, n), (n = (n & -5) | 1))
        : _$1(e);
    } else
      (e.currentChar ^ 8232) <= 1
        ? ((n = (n & -5) | 1), v$1(e))
        : ((n &= -5), _$1(e));
  e.report(18);
}
var x$1;
((e) => {
  (e[(e.Empty = 0)] = "Empty"),
    (e[(e.Escape = 1)] = "Escape"),
    (e[(e.Class = 2)] = "Class");
})((x$1 ||= {}));
var S$1;
((e) => {
  (e[(e.Empty = 0)] = "Empty"),
    (e[(e.IgnoreCase = 1)] = "IgnoreCase"),
    (e[(e.Global = 2)] = "Global"),
    (e[(e.Multiline = 4)] = "Multiline"),
    (e[(e.Unicode = 16)] = "Unicode"),
    (e[(e.Sticky = 8)] = "Sticky"),
    (e[(e.DotAll = 32)] = "DotAll"),
    (e[(e.Indices = 64)] = "Indices"),
    (e[(e.UnicodeSets = 128)] = "UnicodeSets");
})((S$1 ||= {}));
function we(e) {
  let t = e.index,
    n = x$1.Empty;
  loop: for (;;) {
    const t = e.currentChar;
    if ((_$1(e), n & x$1.Escape)) n &= ~x$1.Escape;
    else
      switch (t) {
        case 47:
          if (n) break;
          break loop;
        case 92:
          n |= x$1.Escape;
          break;
        case 91:
          n |= x$1.Class;
          break;
        case 93:
          n &= x$1.Escape;
      }
    if (
      ((t === 13 || t === 10 || t === 8232 || t === 8233) && e.report(34),
      e.index >= e.source.length)
    )
      return e.report(34);
  }
  let r = e.index - 1,
    i = S$1.Empty,
    a = e.currentChar,
    { index: o } = e;
  for (; ve(a); ) {
    switch (a) {
      case 103:
        i & S$1.Global && e.report(36, "g"), (i |= S$1.Global);
        break;
      case 105:
        i & S$1.IgnoreCase && e.report(36, "i"), (i |= S$1.IgnoreCase);
        break;
      case 109:
        i & S$1.Multiline && e.report(36, "m"), (i |= S$1.Multiline);
        break;
      case 117:
        i & S$1.Unicode && e.report(36, "u"),
          i & S$1.UnicodeSets && e.report(36, "vu"),
          (i |= S$1.Unicode);
        break;
      case 118:
        i & S$1.Unicode && e.report(36, "uv"),
          i & S$1.UnicodeSets && e.report(36, "v"),
          (i |= S$1.UnicodeSets);
        break;
      case 121:
        i & S$1.Sticky && e.report(36, "y"), (i |= S$1.Sticky);
        break;
      case 115:
        i & S$1.DotAll && e.report(36, "s"), (i |= S$1.DotAll);
        break;
      case 100:
        i & S$1.Indices && e.report(36, "d"), (i |= S$1.Indices);
        break;
      default:
        e.report(35);
    }
    a = _$1(e);
  }
  const s = e.source.slice(o, e.index),
    c = e.source.slice(t, r);
  return (
    (e.tokenRegExp = {
      pattern: c,
      flags: s,
    }),
    e.options.raw && (e.tokenRaw = e.source.slice(e.tokenIndex, e.index)),
    (e.tokenValue = Te(e, c, s)),
    65540
  );
}
function Te(e, t, n) {
  try {
    return new RegExp(t, n);
  } catch {
    try {
      return new RegExp(t, n), null;
    } catch {
      e.report(34);
    }
  }
}
function Ee(e, t, n) {
  let { index: r } = e,
    i = "",
    a = _$1(e),
    o = e.index;
  for (; !(b$1[a] & 8); ) {
    if (a === n)
      return (
        (i += e.source.slice(o, e.index)),
        _$1(e),
        e.options.raw && (e.tokenRaw = e.source.slice(r, e.index)),
        (e.tokenValue = i),
        134283267
      );
    if ((a & 8) === 8 && a === 92) {
      if (
        ((i += e.source.slice(o, e.index)),
        (a = _$1(e)),
        a < 127 || a === 8232 || a === 8233)
      ) {
        const n = De(e, t, a);
        n >= 0 ? (i += String.fromCodePoint(n)) : Oe(e, n, 0);
      } else i += String.fromCodePoint(a);
      o = e.index + 1;
    } else (a === 8232 || a === 8233) && ((e.column = -1), e.line++);
    e.index >= e.end && e.report(16), (a = _$1(e));
  }
  e.report(16);
}
function De(e, t, n, r = 0) {
  switch (n) {
    case 98:
      return 8;
    case 102:
      return 12;
    case 114:
      return 13;
    case 110:
      return 10;
    case 116:
      return 9;
    case 118:
      return 11;
    case 13:
      if (e.index < e.end) {
        const t = e.source.charCodeAt(e.index + 1);
        t === 10 && ((e.index += 1), (e.currentChar = t));
      }
    case 10:
    case 8232:
    case 8233:
      return (e.column = -1), e.line++, -1;
    case 48:
    case 49:
    case 50:
    case 51: {
      let i = n - 48,
        a = e.index + 1,
        o = e.column + 1;
      if (a < e.end) {
        const n = e.source.charCodeAt(a);
        if (!(b$1[n] & 32)) {
          if (i !== 0 || b$1[n] & 512) {
            if (t & 1 || r) return -2;
            e.flags |= 64;
          }
        } else if (t & 1 || r) return -2;
        else {
          if (
            ((e.currentChar = n),
            (i = (i << 3) | (n - 48)),
            a++,
            o++,
            a < e.end)
          ) {
            const t = e.source.charCodeAt(a);
            b$1[t] & 32 &&
              ((e.currentChar = t), (i = (i << 3) | (t - 48)), a++, o++);
          }
          e.flags |= 64;
        }
        (e.index = a - 1), (e.column = o - 1);
      }
      return i;
    }
    case 52:
    case 53:
    case 54:
    case 55: {
      if (r || t & 1) return -2;
      let i = n - 48,
        a = e.index + 1,
        o = e.column + 1;
      if (a < e.end) {
        const t = e.source.charCodeAt(a);
        b$1[t] & 32 &&
          ((i = (i << 3) | (t - 48)),
          (e.currentChar = t),
          (e.index = a),
          (e.column = o));
      }
      return (e.flags |= 64), i;
    }
    case 120: {
      const t = _$1(e);
      if (!(b$1[t] & 64)) return -4;
      const n = y$1(t),
        r = _$1(e);
      if (!(b$1[r] & 64)) return -4;
      const i = y$1(r);
      return (n << 4) | i;
    }
    case 117: {
      const t = _$1(e);
      if (e.currentChar === 123) {
        let t = 0;
        for (; b$1[_$1(e)] & 64; )
          if (((t = (t << 4) | y$1(e.currentChar)), t > 1114111)) return -5;
        return e.currentChar < 1 || e.currentChar !== 125 ? -4 : t;
      }
      {
        if (!(b$1[t] & 64)) return -4;
        const n = e.source.charCodeAt(e.index + 1);
        if (!(b$1[n] & 64)) return -4;
        const r = e.source.charCodeAt(e.index + 2);
        if (!(b$1[r] & 64)) return -4;
        const i = e.source.charCodeAt(e.index + 3);
        return b$1[i] & 64
          ? ((e.index += 3),
            (e.column += 3),
            (e.currentChar = e.source.charCodeAt(e.index)),
            (y$1(t) << 12) | (y$1(n) << 8) | (y$1(r) << 4) | y$1(i))
          : -4;
      }
    }
    case 56:
    case 57:
      if (r || !e.options.webcompat || t & 1) return -3;
      e.flags |= 4096;
    default:
      return n;
  }
}
function Oe(e, t, n) {
  switch (t) {
    case -1:
      return;
    case -2:
      e.report(n ? 2 : 1);
    case -3:
      e.report(n ? 3 : 14);
    case -4:
      e.report(7);
    case -5:
      e.report(104);
  }
}
function ke(e, t) {
  let { index: n } = e,
    r = 67174409,
    i = "",
    a = _$1(e);
  for (; a !== 96; ) {
    if (a === 36 && e.source.charCodeAt(e.index + 1) === 123) {
      _$1(e), (r = 67174408);
      break;
    }
    if (a === 92)
      if (((a = _$1(e)), a > 126)) i += String.fromCodePoint(a);
      else {
        const { index: n, line: o, column: s } = e,
          c = De(e, t | 1, a, 1);
        if (c >= 0) i += String.fromCodePoint(c);
        else if (c !== -1 && t & 64) {
          (e.index = n),
            (e.line = o),
            (e.column = s),
            (i = null),
            (a = Ae(e, a)),
            a < 0 && (r = 67174408);
          break;
        } else Oe(e, c, 1);
      }
    else
      e.index < e.end &&
        (a === 13 &&
          e.source.charCodeAt(e.index) === 10 &&
          ((i += String.fromCodePoint(a)),
          (e.currentChar = e.source.charCodeAt(++e.index))),
        (((a & 83) < 3 && a === 10) || (a ^ 8232) <= 1) &&
          ((e.column = -1), e.line++),
        (i += String.fromCodePoint(a)));
    e.index >= e.end && e.report(17), (a = _$1(e));
  }
  return (
    _$1(e),
    (e.tokenValue = i),
    (e.tokenRaw = e.source.slice(n + 1, e.index - (r === 67174409 ? 1 : 2))),
    r
  );
}
function Ae(e, t) {
  for (; t !== 96; ) {
    switch (t) {
      case 36: {
        const n = e.index + 1;
        if (n < e.end && e.source.charCodeAt(n) === 123)
          return (e.index = n), e.column++, -t;
        break;
      }
      case 10:
      case 8232:
      case 8233:
        (e.column = -1), e.line++;
    }
    e.index >= e.end && e.report(17), (t = _$1(e));
  }
  return t;
}
function je(e, t) {
  return e.index >= e.end && e.report(0), e.index--, e.column--, ke(e, t);
}
var Me = {
  0: "Unexpected token",
  30: "Unexpected token: '%0'",
  1: "Octal escape sequences are not allowed in strict mode",
  2: "Octal escape sequences are not allowed in template strings",
  3: "\\8 and \\9 are not allowed in template strings",
  4: "Private identifier #%0 is not defined",
  5: "Illegal Unicode escape sequence",
  6: "Invalid code point %0",
  7: "Invalid hexadecimal escape sequence",
  9: "Octal literals are not allowed in strict mode",
  8: "Decimal integer literals with a leading zero are forbidden in strict mode",
  10: "Expected number in radix %0",
  151: "Invalid left-hand side assignment to a destructible right-hand side",
  11: "Non-number found after exponent indicator",
  12: "Invalid BigIntLiteral",
  13: "No identifiers allowed directly after numeric literal",
  14: "Escapes \\8 or \\9 are not syntactically valid escapes",
  15: "Escapes \\8 or \\9 are not allowed in strict mode",
  16: "Unterminated string literal",
  17: "Unterminated template literal",
  18: "Multiline comment was not closed properly",
  19: "The identifier contained dynamic unicode escape that was not closed",
  20: "Illegal character '%0'",
  21: "Missing hexadecimal digits",
  22: "Invalid implicit octal",
  23: "Invalid line break in string literal",
  24: "Only unicode escapes are legal in identifier names",
  25: "Expected '%0'",
  26: "Invalid left-hand side in assignment",
  27: "Invalid left-hand side in async arrow",
  28: 'Calls to super must be in the "constructor" method of a class expression or class declaration that has a superclass',
  29: "Member access on super must be in a method",
  31: "Await expression not allowed in formal parameter",
  32: "Yield expression not allowed in formal parameter",
  95: "Unexpected token: 'escaped keyword'",
  33: "Unary expressions as the left operand of an exponentiation expression must be disambiguated with parentheses",
  123: "Async functions can only be declared at the top level or inside a block",
  34: "Unterminated regular expression",
  35: "Unexpected regular expression flag",
  36: "Duplicate regular expression flag '%0'",
  37: "%0 functions must have exactly %1 argument%2",
  38: "Setter function argument must not be a rest parameter",
  39: "%0 declaration must have a name in this context",
  40: "Function name may not contain any reserved words or be eval or arguments in strict mode",
  41: "The rest operator is missing an argument",
  42: "A getter cannot be a generator",
  43: "A setter cannot be a generator",
  44: "A computed property name must be followed by a colon or paren",
  134: "Object literal keys that are strings or numbers must be a method or have a colon",
  46: "Found `* async x(){}` but this should be `async * x(){}`",
  45: "Getters and setters can not be generators",
  47: "'%0' can not be generator method",
  48: "No line break is allowed after '=>'",
  49: "The left-hand side of the arrow can only be destructed through assignment",
  50: "The binding declaration is not destructible",
  51: "Async arrow can not be followed by new expression",
  52: "Classes may not have a static property named 'prototype'",
  53: "Class constructor may not be a %0",
  54: "Duplicate constructor method in class",
  55: "Invalid increment/decrement operand",
  56: "Invalid use of `new` keyword on an increment/decrement expression",
  57: "`=>` is an invalid assignment target",
  58: "Rest element may not have a trailing comma",
  59: "Missing initializer in %0 declaration",
  60: "'for-%0' loop head declarations can not have an initializer",
  61: "Invalid left-hand side in for-%0 loop: Must have a single binding",
  62: "Invalid shorthand property initializer",
  63: "Property name __proto__ appears more than once in object literal",
  64: "Let is disallowed as a lexically bound name",
  65: "Invalid use of '%0' inside new expression",
  66: "Illegal 'use strict' directive in function with non-simple parameter list",
  67: 'Identifier "let" disallowed as left-hand side expression in strict mode',
  68: "Illegal continue statement",
  69: "Illegal break statement",
  70: "Cannot have `let[...]` as a var name in strict mode",
  71: "Invalid destructuring assignment target",
  72: "Rest parameter may not have a default initializer",
  73: "The rest argument must the be last parameter",
  74: "Invalid rest argument",
  76: "In strict mode code, functions can only be declared at top level or inside a block",
  77: "In non-strict mode code, functions can only be declared at top level, inside a block, or as the body of an if statement",
  78: "Without web compatibility enabled functions can not be declared at top level, inside a block, or as the body of an if statement",
  79: "Class declaration can't appear in single-statement context",
  80: "Invalid left-hand side in for-%0",
  81: "Invalid assignment in for-%0",
  82: "for await (... of ...) is only valid in async functions and async generators",
  83: "The first token after the template expression should be a continuation of the template",
  85: "`let` declaration not allowed here and `let` cannot be a regular var name in strict mode",
  84: "`let \n [` is a restricted production at the start of a statement",
  86: "Catch clause requires exactly one parameter, not more (and no trailing comma)",
  87: "Catch clause parameter does not support default values",
  88: "Missing catch or finally after try",
  89: "More than one default clause in switch statement",
  90: "Illegal newline after throw",
  91: "Strict mode code may not include a with statement",
  92: "Illegal return statement",
  93: "The left hand side of the for-header binding declaration is not destructible",
  94: "new.target only allowed within functions or static blocks",
  96: "'#' not followed by identifier",
  102: "Invalid keyword",
  101: "Can not use 'let' as a class name",
  100: "'A lexical declaration can't define a 'let' binding",
  99: "Can not use `let` as variable name in strict mode",
  97: "'%0' may not be used as an identifier in this context",
  98: "Await is only valid in async functions",
  103: "The %0 keyword can only be used with the module goal",
  104: "Unicode codepoint must not be greater than 0x10FFFF",
  105: "%0 source must be string",
  106: "Only a identifier or string can be used to indicate alias",
  107: "Only '*' or '{...}' can be imported after default",
  108: "Trailing decorator may be followed by method",
  109: "Decorators can't be used with a constructor",
  110: "Can not use `await` as identifier in module or async func",
  111: "Can not use `await` as identifier in module",
  112: "HTML comments are only allowed with web compatibility (Annex B)",
  113: "The identifier 'let' must not be in expression position in strict mode",
  114: "Cannot assign to `eval` and `arguments` in strict mode",
  115: "The left-hand side of a for-of loop may not start with 'let'",
  116: "Block body arrows can not be immediately invoked without a group",
  117: "Block body arrows can not be immediately accessed without a group",
  118: "Unexpected strict mode reserved word",
  119: "Unexpected eval or arguments in strict mode",
  120: "Decorators must not be followed by a semicolon",
  121: "Calling delete on expression not allowed in strict mode",
  122: "Pattern can not have a tail",
  124: "Can not have a `yield` expression on the left side of a ternary",
  125: "An arrow function can not have a postfix update operator",
  126: "Invalid object literal key character after generator star",
  127: "Private fields can not be deleted",
  129: "Classes may not have a field called constructor",
  128: "Classes may not have a private element named constructor",
  130: "A class field initializer or static block may not contain arguments",
  131: "Generators can only be declared at the top level or inside a block",
  132: "Async methods are a restricted production and cannot have a newline following it",
  133: "Unexpected character after object literal property name",
  135: "Invalid key token",
  136: "Label '%0' has already been declared",
  137: "continue statement must be nested within an iteration statement",
  138: "Undefined label '%0'",
  139: "Trailing comma is disallowed inside import(...) arguments",
  140: "Invalid binding in JSON import",
  141: "import() requires exactly one argument",
  142: "Cannot use new with import(...)",
  143: "... is not allowed in import()",
  144: "Expected '=>'",
  145: "Duplicate binding '%0'",
  146: "Duplicate private identifier #%0",
  147: "Cannot export a duplicate name '%0'",
  150: "Duplicate %0 for-binding",
  148: "Exported binding '%0' needs to refer to a top-level declared variable",
  149: "Unexpected private field",
  153: "Numeric separators are not allowed at the end of numeric literals",
  152: "Only one underscore is allowed as numeric separator",
  154: "JSX value should be either an expression or a quoted JSX text",
  155: "Expected corresponding JSX closing tag for %0",
  156: "Adjacent JSX elements must be wrapped in an enclosing tag",
  157: "JSX attributes must only be assigned a non-empty 'expression'",
  158: "'%0' has already been declared",
  159: "'%0' shadowed a catch clause binding",
  160: "Dot property must be an identifier",
  161: "Encountered invalid input after spread/rest argument",
  162: "Catch without try",
  163: "Finally without try",
  164: "Expected corresponding closing tag for JSX fragment",
  165: "Coalescing and logical operators used together in the same expression must be disambiguated with parentheses",
  166: "Invalid tagged template on optional chain",
  167: "Invalid optional chain from super property",
  168: "Invalid optional chain from new expression",
  169: 'Cannot use "import.meta" outside a module',
  170: "Leading decorators must be attached to a class declaration",
  171: "An export name cannot include a lone surrogate, found %0",
  172: "A string literal cannot be used as an exported binding without `from`",
  173: "Private fields can't be accessed on super",
  174: "The only valid meta property for import is 'import.meta'",
  175: "'import.meta' must not contain escaped characters",
  176: 'cannot use "await" as identifier inside an async function',
  177: 'cannot use "await" in static blocks',
};
var C$1 = class extends SyntaxError {
  start;
  end;
  range;
  loc;
  description;
  constructor(e, t, n, ...r) {
    const i = Me[n].replace(/%(\d+)/g, (_e, t) => r[t]),
      a =
        "[" +
        e.line +
        ":" +
        e.column +
        "-" +
        t.line +
        ":" +
        t.column +
        "]: " +
        i;
    super(a),
      (this.start = e.index),
      (this.end = t.index),
      (this.range = [e.index, t.index]),
      (this.loc = {
        start: {
          line: e.line,
          column: e.column,
        },
        end: {
          line: t.line,
          column: t.column,
        },
      }),
      (this.description = i);
  }
};
function Ne(e, t, n) {
  let r = e.currentChar,
    i = 0,
    a = 9,
    o = n & 64 ? 0 : 1,
    s = 0,
    c = 0;
  if (n & 64)
    (i = `.${Pe(e, r)}`), (r = e.currentChar), r === 110 && e.report(12);
  else {
    if (r === 48)
      if (((r = _$1(e)), (r | 32) === 120)) {
        for (n = 136, r = _$1(e); b$1[r] & 4160; ) {
          if (r === 95) {
            c || e.report(152), (c = 0), (r = _$1(e));
            continue;
          }
          (c = 1), (i = i * 16 + y$1(r)), s++, (r = _$1(e));
        }
        (s === 0 || !c) && e.report(s === 0 ? 21 : 153);
      } else if ((r | 32) === 111) {
        for (n = 132, r = _$1(e); b$1[r] & 4128; ) {
          if (r === 95) {
            c || e.report(152), (c = 0), (r = _$1(e));
            continue;
          }
          (c = 1), (i = i * 8 + (r - 48)), s++, (r = _$1(e));
        }
        (s === 0 || !c) && e.report(s === 0 ? 0 : 153);
      } else if ((r | 32) === 98) {
        for (n = 130, r = _$1(e); b$1[r] & 4224; ) {
          if (r === 95) {
            c || e.report(152), (c = 0), (r = _$1(e));
            continue;
          }
          (c = 1), (i = i * 2 + (r - 48)), s++, (r = _$1(e));
        }
        (s === 0 || !c) && e.report(s === 0 ? 0 : 153);
      } else if (b$1[r] & 32)
        for (t & 1 && e.report(1), n = 1; b$1[r] & 16; ) {
          if (b$1[r] & 512) {
            (n = 32), (o = 0);
            break;
          }
          (i = i * 8 + (r - 48)), (r = _$1(e));
        }
      else
        b$1[r] & 512
          ? (t & 1 && e.report(1), (e.flags |= 64), (n = 32))
          : r === 95 && e.report(0);
    if (n & 48) {
      if (o) {
        for (; a >= 0 && b$1[r] & 4112; ) {
          if (r === 95) {
            if (((r = _$1(e)), r === 95 || n & 32))
              throw new C$1(
                e.currentLocation,
                {
                  index: e.index + 1,
                  line: e.line,
                  column: e.column,
                },
                152,
              );
            c = 1;
            continue;
          }
          (c = 0), (i = 10 * i + (r - 48)), (r = _$1(e)), --a;
        }
        if (c)
          throw new C$1(
            e.currentLocation,
            {
              index: e.index + 1,
              line: e.line,
              column: e.column,
            },
            153,
          );
        if (a >= 0 && !_e(r) && r !== 46)
          return (
            (e.tokenValue = i),
            e.options.raw &&
              (e.tokenRaw = e.source.slice(e.tokenIndex, e.index)),
            134283266
          );
      }
      (i += Pe(e, r)),
        (r = e.currentChar),
        r === 46 &&
          (_$1(e) === 95 && e.report(0),
          (n = 64),
          (i += `.${Pe(e, e.currentChar)}`),
          (r = e.currentChar));
    }
  }
  let l = e.index,
    u = 0;
  if (r === 110 && n & 128) (u = 1), (r = _$1(e));
  else if ((r | 32) === 101) {
    (r = _$1(e)), b$1[r] & 256 && (r = _$1(e));
    const { index: t } = e;
    b$1[r] & 16 || e.report(11),
      (i += e.source.substring(l, t) + Pe(e, r)),
      (r = e.currentChar);
  }
  return (
    ((e.index < e.end && b$1[r] & 16) || _e(r)) && e.report(13),
    u
      ? ((e.tokenRaw = e.source.slice(e.tokenIndex, e.index)),
        (e.tokenValue = BigInt(e.tokenRaw.slice(0, -1).replaceAll("_", ""))),
        134283388)
      : ((e.tokenValue =
          n & 15
            ? i
            : n & 32
              ? parseFloat(e.source.substring(e.tokenIndex, e.index))
              : +i),
        e.options.raw && (e.tokenRaw = e.source.slice(e.tokenIndex, e.index)),
        134283266)
  );
}
function Pe(e, t) {
  let n = 0,
    r = e.index,
    i = "";
  for (; b$1[t] & 4112; ) {
    if (t === 95) {
      const { index: a } = e;
      if (((t = _$1(e)), t === 95))
        throw new C$1(
          e.currentLocation,
          {
            index: e.index + 1,
            line: e.line,
            column: e.column,
          },
          152,
        );
      (n = 1), (i += e.source.substring(r, a)), (r = e.index);
      continue;
    }
    (n = 0), (t = _$1(e));
  }
  if (n)
    throw new C$1(
      e.currentLocation,
      {
        index: e.index + 1,
        line: e.line,
        column: e.column,
      },
      153,
    );
  return i + e.source.substring(r, e.index);
}
var w$1 = [
  "end of source",
  "identifier",
  "number",
  "string",
  "regular expression",
  "false",
  "true",
  "null",
  "template continuation",
  "template tail",
  "=>",
  "(",
  "{",
  ".",
  "...",
  "}",
  ")",
  ";",
  ",",
  "[",
  "]",
  ":",
  "?",
  "'",
  '"',
  "++",
  "--",
  "=",
  "<<=",
  ">>=",
  ">>>=",
  "**=",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "^=",
  "|=",
  "&=",
  "||=",
  "&&=",
  "??=",
  "typeof",
  "delete",
  "void",
  "!",
  "~",
  "+",
  "-",
  "in",
  "instanceof",
  "*",
  "%",
  "/",
  "**",
  "&&",
  "||",
  "===",
  "!==",
  "==",
  "!=",
  "<=",
  ">=",
  "<",
  ">",
  "<<",
  ">>",
  ">>>",
  "&",
  "|",
  "^",
  "var",
  "let",
  "const",
  "break",
  "case",
  "catch",
  "class",
  "continue",
  "debugger",
  "default",
  "do",
  "else",
  "export",
  "extends",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "new",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "try",
  "while",
  "with",
  "implements",
  "interface",
  "package",
  "private",
  "protected",
  "public",
  "static",
  "yield",
  "as",
  "async",
  "await",
  "constructor",
  "get",
  "set",
  "accessor",
  "from",
  "of",
  "enum",
  "eval",
  "arguments",
  "escaped keyword",
  "escaped future reserved keyword",
  "reserved if strict",
  "#",
  "BigIntLiteral",
  "??",
  "?.",
  "WhiteSpace",
  "Illegal",
  "LineTerminator",
  "PrivateField",
  "Template",
  "@",
  "target",
  "meta",
  "LineFeed",
  "Escaped",
  "JSXText",
];
var Fe = {
  this: 86111,
  function: 86104,
  if: 20569,
  return: 20572,
  var: 86088,
  else: 20563,
  for: 20567,
  new: 86107,
  in: 8673330,
  typeof: 16863275,
  while: 20578,
  case: 20556,
  break: 20555,
  try: 20577,
  catch: 20557,
  delete: 16863276,
  throw: 86112,
  switch: 86110,
  continue: 20559,
  default: 20561,
  instanceof: 8411187,
  do: 20562,
  void: 16863277,
  finally: 20566,
  async: 209005,
  await: 209006,
  class: 86094,
  const: 86090,
  constructor: 12399,
  debugger: 20560,
  export: 20564,
  extends: 20565,
  false: 86021,
  from: 209011,
  get: 209008,
  implements: 36964,
  import: 86106,
  interface: 36965,
  let: 241737,
  null: 86023,
  of: 471156,
  package: 36966,
  private: 36967,
  protected: 36968,
  public: 36969,
  set: 209009,
  static: 36970,
  super: 86109,
  true: 86022,
  with: 20579,
  yield: 241771,
  enum: 86133,
  eval: 537079926,
  as: 77932,
  arguments: 537079927,
  target: 209029,
  meta: 209030,
  accessor: 12402,
};
function T$1(e, t) {
  !(e.flags & 1) &&
    (e.getToken() & 1048576) !== 1048576 &&
    e.report(30, w$1[e.getToken() & 255]),
    E$1(e, t, 1074790417) || e.options.onInsertedSemicolon?.(e.startIndex);
}
function Ie(e, t, n, r) {
  return t - n < 13 &&
    r === "use strict" &&
    ((e.getToken() & 1048576) === 1048576 || e.flags & 1)
    ? 1
    : 0;
}
function Le(e, t, n) {
  return e.getToken() === n ? (A$1(e, t), 1) : 0;
}
function E$1(e, t, n) {
  return e.getToken() === n && (A$1(e, t), !0);
}
function D$1(e, t, n) {
  e.getToken() !== n && e.report(25, w$1[n & 255]), A$1(e, t);
}
function O(e, t) {
  switch (t.type) {
    case "ArrayExpression": {
      t.type = "ArrayPattern";
      const { elements: n } = t;
      for (let t = 0, r = n.length; t < r; ++t) {
        const r = n[t];
        r && O(e, r);
      }
      return;
    }
    case "ObjectExpression": {
      t.type = "ObjectPattern";
      const { properties: n } = t;
      for (let t = 0, r = n.length; t < r; ++t) O(e, n[t]);
      return;
    }
    case "AssignmentExpression":
      (t.type = "AssignmentPattern"),
        t.operator !== "=" && e.report(71),
        delete t.operator,
        O(e, t.left);
      return;
    case "Property":
      O(e, t.value);
      return;
    case "SpreadElement":
      (t.type = "RestElement"), O(e, t.argument);
  }
}
function Re(e, t, n, r, i) {
  t & 1 &&
    ((r & 36864) === 36864 && e.report(118),
    !i && (r & 537079808) === 537079808 && e.report(119)),
    ((r & 20480) === 20480 || r === -2147483528) && e.report(102),
    n & 24 && (r & 255) === 73 && e.report(100),
    t & 2050 && r === 209006 && e.report(110),
    t & 1025 && r === 241771 && e.report(97, "yield");
}
function ze(e, t, n) {
  t & 1 &&
    ((n & 36864) === 36864 && e.report(118),
    (n & 537079808) === 537079808 && e.report(119),
    n === -2147483527 && e.report(95),
    n === -2147483528 && e.report(95)),
    (n & 20480) === 20480 && e.report(102),
    t & 2050 && n === 209006 && e.report(110),
    t & 1025 && n === 241771 && e.report(97, "yield");
}
function Be(e, t, n) {
  return (
    n === 209006 && (t & 2050 && e.report(110), (e.destructible |= 128)),
    n === 241771 && t & 1024 && e.report(97, "yield"),
    (n & 20480) === 20480 || (n & 36864) === 36864 || n === -2147483527
  );
}
function Ve(e) {
  return e.property ? e.property.type === "PrivateIdentifier" : !1;
}
function He(e, t, n, r) {
  for (; t; ) {
    if (t[`$${n}`]) return r && e.report(137), 1;
    r && t.loop && (r = 0), (t = t.$);
  }
  return 0;
}
function Ue(e, t, n) {
  let r = t;
  for (; r; ) r[`$${n}`] && e.report(136, n), (r = r.$);
  t[`$${n}`] = 1;
}
function We(e) {
  switch (e.type) {
    case "JSXIdentifier":
      return e.name;
    case "JSXNamespacedName":
      return `${e.namespace}:${e.name}`;
    case "JSXMemberExpression":
      return `${We(e.object)}.${We(e.property)}`;
  }
}
function k$1(e, t) {
  return e & 1025
    ? (e & 2 && t === 209006) || (e & 1024 && t === 241771)
      ? !1
      : (t & 12288) === 12288
    : (t & 12288) === 12288 || (t & 36864) === 36864;
}
function Ge(e, t, n) {
  (n & 537079808) === 537079808 && (t & 1 && e.report(119), (e.flags |= 512)),
    k$1(t, n) || e.report(0);
}
function Ke(e, t) {
  return Object.hasOwn(e, t) ? e[t] : void 0;
}
function qe(e, t, n) {
  for (; ge[_$1(e)]; );
  return (
    (e.tokenValue = e.source.slice(e.tokenIndex, e.index)),
    e.currentChar !== 92 && e.currentChar <= 126
      ? (Ke(Fe, e.tokenValue) ?? 208897)
      : Ye(e, t, 0, n)
  );
}
function Je(e, t) {
  const n = Ze(e);
  return (
    _e(n) || e.report(5),
    (e.tokenValue = String.fromCodePoint(n)),
    Ye(e, t, 1, b$1[n] & 4)
  );
}
function Ye(e, t, n, r) {
  let i = e.index;
  for (; e.index < e.end; )
    if (e.currentChar === 92) {
      (e.tokenValue += e.source.slice(i, e.index)), (n = 1);
      const t = Ze(e);
      ve(t) || e.report(5),
        (r &&= b$1[t] & 4),
        (e.tokenValue += String.fromCodePoint(t)),
        (i = e.index);
    } else {
      const t = de(e);
      if (t > 0)
        ve(t) || e.report(20, String.fromCodePoint(t)),
          (e.currentChar = t),
          e.index++,
          e.column++;
      else if (!ve(e.currentChar)) break;
      _$1(e);
    }
  e.index <= e.end && (e.tokenValue += e.source.slice(i, e.index));
  const { length: a } = e.tokenValue;
  if (r && a >= 2 && a <= 11) {
    const r = Ke(Fe, e.tokenValue);
    return r === void 0
      ? 208897 | (n ? -2147483648 : 0)
      : n
        ? r === 209006
          ? t & 2050
            ? -2147483528
            : r | -2147483648
          : t & 1
            ? r === 36970 || (r & 36864) === 36864
              ? -2147483527
              : (r & 20480) === 20480
                ? t & 262144 && !(t & 8)
                  ? r | -2147483648
                  : -2147483528
                : -2147274630
            : t & 262144 && !(t & 8) && (r & 20480) === 20480
              ? r | -2147483648
              : r === 241771
                ? t & 262144
                  ? -2147274630
                  : t & 1024
                    ? -2147483528
                    : r | -2147483648
                : r === 209005
                  ? -2147274630
                  : (r & 36864) === 36864
                    ? r | -2147471360
                    : -2147483528
        : r;
  }
  return 208897 | (n ? -2147483648 : 0);
}
function Xe(e) {
  let t = _$1(e);
  if (t === 92) return 130;
  const n = de(e);
  return n && (t = n), _e(t) || e.report(96), 130;
}
function Ze(e) {
  return (
    e.source.charCodeAt(e.index + 1) !== 117 && e.report(5),
    (e.currentChar = e.source.charCodeAt((e.index += 2))),
    (e.column += 2),
    Qe(e)
  );
}
function Qe(e) {
  let t = 0,
    n = e.currentChar;
  if (n === 123) {
    const n = e.index - 2;
    for (; b$1[_$1(e)] & 64; )
      if (((t = (t << 4) | y$1(e.currentChar)), t > 1114111))
        throw new C$1(
          {
            index: n,
            line: e.line,
            column: e.column,
          },
          e.currentLocation,
          104,
        );
    if (e.currentChar !== 125)
      throw new C$1(
        {
          index: n,
          line: e.line,
          column: e.column,
        },
        e.currentLocation,
        7,
      );
    return _$1(e), t;
  }
  b$1[n] & 64 || e.report(7);
  const r = e.source.charCodeAt(e.index + 1);
  b$1[r] & 64 || e.report(7);
  const i = e.source.charCodeAt(e.index + 2);
  b$1[i] & 64 || e.report(7);
  const a = e.source.charCodeAt(e.index + 3);
  return (
    b$1[a] & 64 || e.report(7),
    (t = (y$1(n) << 12) | (y$1(r) << 8) | (y$1(i) << 4) | y$1(a)),
    (e.currentChar = e.source.charCodeAt((e.index += 4))),
    (e.column += 4),
    t
  );
}
var $e = [
  128, 128, 128, 128, 128, 128, 128, 128, 128, 127, 135, 127, 127, 129, 128,
  128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128,
  128, 128, 127, 16842798, 134283267, 130, 208897, 8391477, 8390213, 134283267,
  67174411, 16, 8391476, 25233968, 18, 25233969, 67108877, 8457014, 134283266,
  134283266, 134283266, 134283266, 134283266, 134283266, 134283266, 134283266,
  134283266, 134283266, 21, 1074790417, 8456256, 1077936155, 8390721, 22, 132,
  208897, 208897, 208897, 208897, 208897, 208897, 208897, 208897, 208897,
  208897, 208897, 208897, 208897, 208897, 208897, 208897, 208897, 208897,
  208897, 208897, 208897, 208897, 208897, 208897, 208897, 208897, 69271571, 136,
  20, 8389959, 208897, 131, 4096, 4096, 4096, 4096, 4096, 4096, 4096, 208897,
  4096, 208897, 208897, 4096, 208897, 4096, 208897, 4096, 208897, 4096, 4096,
  4096, 208897, 4096, 4096, 208897, 4096, 4096, 2162700, 8389702, 1074790415,
  16842799, 128,
];
function A$1(e, t) {
  (e.flags = (e.flags | 1) ^ 1),
    (e.startIndex = e.index),
    (e.startColumn = e.column),
    (e.startLine = e.line),
    e.setToken(et(e, t, 0));
}
function et(e, t, n) {
  let r = e.index === 0,
    { source: i } = e,
    a = e.currentLocation;
  for (; e.index < e.end; ) {
    (e.tokenIndex = e.index),
      (e.tokenColumn = e.column),
      (e.tokenLine = e.line);
    let o = e.currentChar;
    if (o <= 126) {
      const s = $e[o];
      switch (s) {
        case 67174411:
        case 16:
        case 2162700:
        case 1074790415:
        case 69271571:
        case 20:
        case 21:
        case 1074790417:
        case 18:
        case 16842799:
        case 132:
        case 128:
          return _$1(e), s;
        case 208897:
          return qe(e, t, 0);
        case 4096:
          return qe(e, t, 1);
        case 134283266:
          return Ne(e, t, 144);
        case 134283267:
          return Ee(e, t, o);
        case 131:
          return ke(e, t);
        case 136:
          return Je(e, t);
        case 130:
          return Xe(e);
        case 127:
          _$1(e);
          break;
        case 129:
          (n |= 5), v$1(e);
          break;
        case 135:
          fe(e, n), (n = (n & -5) | 1);
          break;
        case 8456256: {
          const r = _$1(e);
          if (e.index < e.end) {
            if (r === 60)
              return e.index < e.end && _$1(e) === 61
                ? (_$1(e), 4194332)
                : 8390978;
            if (r === 61) return _$1(e), 8390718;
            if (r === 33) {
              const r = e.index + 1;
              if (
                r + 1 < e.end &&
                i.charCodeAt(r) === 45 &&
                i.charCodeAt(r + 1) === 45
              ) {
                (e.column += 3),
                  (e.currentChar = i.charCodeAt((e.index += 3))),
                  (n = xe(e, i, n, t, 2, e.tokenStart)),
                  (a = e.tokenStart);
                continue;
              }
              return 8456256;
            }
          }
          return 8456256;
        }
        case 1077936155: {
          _$1(e);
          const t = e.currentChar;
          return t === 61
            ? _$1(e) === 61
              ? (_$1(e), 8390458)
              : 8390460
            : t === 62
              ? (_$1(e), 10)
              : 1077936155;
        }
        case 16842798:
          return _$1(e) === 61
            ? _$1(e) === 61
              ? (_$1(e), 8390459)
              : 8390461
            : 16842798;
        case 8391477:
          return _$1(e) === 61 ? (_$1(e), 4194340) : 8391477;
        case 8391476: {
          if ((_$1(e), e.index >= e.end)) return 8391476;
          const t = e.currentChar;
          return t === 61
            ? (_$1(e), 4194338)
            : t === 42
              ? _$1(e) === 61
                ? (_$1(e), 4194335)
                : 8391735
              : 8391476;
        }
        case 8389959:
          return _$1(e) === 61 ? (_$1(e), 4194341) : 8389959;
        case 25233968: {
          _$1(e);
          const t = e.currentChar;
          return t === 43
            ? (_$1(e), 33619993)
            : t === 61
              ? (_$1(e), 4194336)
              : 25233968;
        }
        case 25233969: {
          _$1(e);
          const o = e.currentChar;
          if (o === 45) {
            if ((_$1(e), (n & 1 || r) && e.currentChar === 62)) {
              e.options.webcompat || e.report(112),
                _$1(e),
                (n = xe(e, i, n, t, 3, a)),
                (a = e.tokenStart);
              continue;
            }
            return 33619994;
          }
          return o === 61 ? (_$1(e), 4194337) : 25233969;
        }
        case 8457014:
          if ((_$1(e), e.index < e.end)) {
            const r = e.currentChar;
            if (r === 47) {
              _$1(e), (n = Se(e, i, n, 0, e.tokenStart)), (a = e.tokenStart);
              continue;
            }
            if (r === 42) {
              _$1(e), (n = Ce(e, i, n)), (a = e.tokenStart);
              continue;
            }
            if (t & 32) return we(e);
            if (r === 61) return _$1(e), 4259875;
          }
          return 8457014;
        case 67108877: {
          const n = _$1(e);
          if (n >= 48 && n <= 57) return Ne(e, t, 80);
          if (n === 46) {
            const t = e.index + 1;
            if (t < e.end && i.charCodeAt(t) === 46)
              return (
                (e.column += 2),
                (e.currentChar = i.charCodeAt((e.index += 2))),
                14
              );
          }
          return 67108877;
        }
        case 8389702: {
          _$1(e);
          const t = e.currentChar;
          return t === 124
            ? (_$1(e), e.currentChar === 61 ? (_$1(e), 4194344) : 8913465)
            : t === 61
              ? (_$1(e), 4194342)
              : 8389702;
        }
        case 8390721: {
          _$1(e);
          const t = e.currentChar;
          if (t === 61) return _$1(e), 8390719;
          if (t !== 62) return 8390721;
          if ((_$1(e), e.index < e.end)) {
            const t = e.currentChar;
            if (t === 62) return _$1(e) === 61 ? (_$1(e), 4194334) : 8390980;
            if (t === 61) return _$1(e), 4194333;
          }
          return 8390979;
        }
        case 8390213: {
          _$1(e);
          const t = e.currentChar;
          return t === 38
            ? (_$1(e), e.currentChar === 61 ? (_$1(e), 4194345) : 8913720)
            : t === 61
              ? (_$1(e), 4194343)
              : 8390213;
        }
        case 22: {
          let t = _$1(e);
          if (t === 63)
            return _$1(e), e.currentChar === 61 ? (_$1(e), 4194346) : 276824445;
          if (t === 46) {
            const n = e.index + 1;
            if (n < e.end && ((t = i.charCodeAt(n)), !(t >= 48 && t <= 57)))
              return _$1(e), 67108990;
          }
          return 22;
        }
      }
    } else {
      if ((o ^ 8232) <= 1) {
        (n = (n & -5) | 1), v$1(e);
        continue;
      }
      const r = de(e);
      if ((r > 0 && (o = r), ue(o))) return (e.tokenValue = ""), Ye(e, t, 0, 0);
      if (pe(o)) {
        _$1(e);
        continue;
      }
      e.report(20, String.fromCodePoint(o));
    }
  }
  return 1048576;
}
var tt = {
  AElig: "Æ",
  AMP: "&",
  Aacute: "Á",
  Abreve: "Ă",
  Acirc: "Â",
  Acy: "А",
  Afr: "𝔄",
  Agrave: "À",
  Alpha: "Α",
  Amacr: "Ā",
  And: "⩓",
  Aogon: "Ą",
  Aopf: "𝔸",
  ApplyFunction: "⁡",
  Aring: "Å",
  Ascr: "𝒜",
  Assign: "≔",
  Atilde: "Ã",
  Auml: "Ä",
  Backslash: "∖",
  Barv: "⫧",
  Barwed: "⌆",
  Bcy: "Б",
  Because: "∵",
  Bernoullis: "ℬ",
  Beta: "Β",
  Bfr: "𝔅",
  Bopf: "𝔹",
  Breve: "˘",
  Bscr: "ℬ",
  Bumpeq: "≎",
  CHcy: "Ч",
  COPY: "©",
  Cacute: "Ć",
  Cap: "⋒",
  CapitalDifferentialD: "ⅅ",
  Cayleys: "ℭ",
  Ccaron: "Č",
  Ccedil: "Ç",
  Ccirc: "Ĉ",
  Cconint: "∰",
  Cdot: "Ċ",
  Cedilla: "¸",
  CenterDot: "·",
  Cfr: "ℭ",
  Chi: "Χ",
  CircleDot: "⊙",
  CircleMinus: "⊖",
  CirclePlus: "⊕",
  CircleTimes: "⊗",
  ClockwiseContourIntegral: "∲",
  CloseCurlyDoubleQuote: "”",
  CloseCurlyQuote: "’",
  Colon: "∷",
  Colone: "⩴",
  Congruent: "≡",
  Conint: "∯",
  ContourIntegral: "∮",
  Copf: "ℂ",
  Coproduct: "∐",
  CounterClockwiseContourIntegral: "∳",
  Cross: "⨯",
  Cscr: "𝒞",
  Cup: "⋓",
  CupCap: "≍",
  DD: "ⅅ",
  DDotrahd: "⤑",
  DJcy: "Ђ",
  DScy: "Ѕ",
  DZcy: "Џ",
  Dagger: "‡",
  Darr: "↡",
  Dashv: "⫤",
  Dcaron: "Ď",
  Dcy: "Д",
  Del: "∇",
  Delta: "Δ",
  Dfr: "𝔇",
  DiacriticalAcute: "´",
  DiacriticalDot: "˙",
  DiacriticalDoubleAcute: "˝",
  DiacriticalGrave: "`",
  DiacriticalTilde: "˜",
  Diamond: "⋄",
  DifferentialD: "ⅆ",
  Dopf: "𝔻",
  Dot: "¨",
  DotDot: "⃜",
  DotEqual: "≐",
  DoubleContourIntegral: "∯",
  DoubleDot: "¨",
  DoubleDownArrow: "⇓",
  DoubleLeftArrow: "⇐",
  DoubleLeftRightArrow: "⇔",
  DoubleLeftTee: "⫤",
  DoubleLongLeftArrow: "⟸",
  DoubleLongLeftRightArrow: "⟺",
  DoubleLongRightArrow: "⟹",
  DoubleRightArrow: "⇒",
  DoubleRightTee: "⊨",
  DoubleUpArrow: "⇑",
  DoubleUpDownArrow: "⇕",
  DoubleVerticalBar: "∥",
  DownArrow: "↓",
  DownArrowBar: "⤓",
  DownArrowUpArrow: "⇵",
  DownBreve: "̑",
  DownLeftRightVector: "⥐",
  DownLeftTeeVector: "⥞",
  DownLeftVector: "↽",
  DownLeftVectorBar: "⥖",
  DownRightTeeVector: "⥟",
  DownRightVector: "⇁",
  DownRightVectorBar: "⥗",
  DownTee: "⊤",
  DownTeeArrow: "↧",
  Downarrow: "⇓",
  Dscr: "𝒟",
  Dstrok: "Đ",
  ENG: "Ŋ",
  ETH: "Ð",
  Eacute: "É",
  Ecaron: "Ě",
  Ecirc: "Ê",
  Ecy: "Э",
  Edot: "Ė",
  Efr: "𝔈",
  Egrave: "È",
  Element: "∈",
  Emacr: "Ē",
  EmptySmallSquare: "◻",
  EmptyVerySmallSquare: "▫",
  Eogon: "Ę",
  Eopf: "𝔼",
  Epsilon: "Ε",
  Equal: "⩵",
  EqualTilde: "≂",
  Equilibrium: "⇌",
  Escr: "ℰ",
  Esim: "⩳",
  Eta: "Η",
  Euml: "Ë",
  Exists: "∃",
  ExponentialE: "ⅇ",
  Fcy: "Ф",
  Ffr: "𝔉",
  FilledSmallSquare: "◼",
  FilledVerySmallSquare: "▪",
  Fopf: "𝔽",
  ForAll: "∀",
  Fouriertrf: "ℱ",
  Fscr: "ℱ",
  GJcy: "Ѓ",
  GT: ">",
  Gamma: "Γ",
  Gammad: "Ϝ",
  Gbreve: "Ğ",
  Gcedil: "Ģ",
  Gcirc: "Ĝ",
  Gcy: "Г",
  Gdot: "Ġ",
  Gfr: "𝔊",
  Gg: "⋙",
  Gopf: "𝔾",
  GreaterEqual: "≥",
  GreaterEqualLess: "⋛",
  GreaterFullEqual: "≧",
  GreaterGreater: "⪢",
  GreaterLess: "≷",
  GreaterSlantEqual: "⩾",
  GreaterTilde: "≳",
  Gscr: "𝒢",
  Gt: "≫",
  HARDcy: "Ъ",
  Hacek: "ˇ",
  Hat: "^",
  Hcirc: "Ĥ",
  Hfr: "ℌ",
  HilbertSpace: "ℋ",
  Hopf: "ℍ",
  HorizontalLine: "─",
  Hscr: "ℋ",
  Hstrok: "Ħ",
  HumpDownHump: "≎",
  HumpEqual: "≏",
  IEcy: "Е",
  IJlig: "Ĳ",
  IOcy: "Ё",
  Iacute: "Í",
  Icirc: "Î",
  Icy: "И",
  Idot: "İ",
  Ifr: "ℑ",
  Igrave: "Ì",
  Im: "ℑ",
  Imacr: "Ī",
  ImaginaryI: "ⅈ",
  Implies: "⇒",
  Int: "∬",
  Integral: "∫",
  Intersection: "⋂",
  InvisibleComma: "⁣",
  InvisibleTimes: "⁢",
  Iogon: "Į",
  Iopf: "𝕀",
  Iota: "Ι",
  Iscr: "ℐ",
  Itilde: "Ĩ",
  Iukcy: "І",
  Iuml: "Ï",
  Jcirc: "Ĵ",
  Jcy: "Й",
  Jfr: "𝔍",
  Jopf: "𝕁",
  Jscr: "𝒥",
  Jsercy: "Ј",
  Jukcy: "Є",
  KHcy: "Х",
  KJcy: "Ќ",
  Kappa: "Κ",
  Kcedil: "Ķ",
  Kcy: "К",
  Kfr: "𝔎",
  Kopf: "𝕂",
  Kscr: "𝒦",
  LJcy: "Љ",
  LT: "<",
  Lacute: "Ĺ",
  Lambda: "Λ",
  Lang: "⟪",
  Laplacetrf: "ℒ",
  Larr: "↞",
  Lcaron: "Ľ",
  Lcedil: "Ļ",
  Lcy: "Л",
  LeftAngleBracket: "⟨",
  LeftArrow: "←",
  LeftArrowBar: "⇤",
  LeftArrowRightArrow: "⇆",
  LeftCeiling: "⌈",
  LeftDoubleBracket: "⟦",
  LeftDownTeeVector: "⥡",
  LeftDownVector: "⇃",
  LeftDownVectorBar: "⥙",
  LeftFloor: "⌊",
  LeftRightArrow: "↔",
  LeftRightVector: "⥎",
  LeftTee: "⊣",
  LeftTeeArrow: "↤",
  LeftTeeVector: "⥚",
  LeftTriangle: "⊲",
  LeftTriangleBar: "⧏",
  LeftTriangleEqual: "⊴",
  LeftUpDownVector: "⥑",
  LeftUpTeeVector: "⥠",
  LeftUpVector: "↿",
  LeftUpVectorBar: "⥘",
  LeftVector: "↼",
  LeftVectorBar: "⥒",
  Leftarrow: "⇐",
  Leftrightarrow: "⇔",
  LessEqualGreater: "⋚",
  LessFullEqual: "≦",
  LessGreater: "≶",
  LessLess: "⪡",
  LessSlantEqual: "⩽",
  LessTilde: "≲",
  Lfr: "𝔏",
  Ll: "⋘",
  Lleftarrow: "⇚",
  Lmidot: "Ŀ",
  LongLeftArrow: "⟵",
  LongLeftRightArrow: "⟷",
  LongRightArrow: "⟶",
  Longleftarrow: "⟸",
  Longleftrightarrow: "⟺",
  Longrightarrow: "⟹",
  Lopf: "𝕃",
  LowerLeftArrow: "↙",
  LowerRightArrow: "↘",
  Lscr: "ℒ",
  Lsh: "↰",
  Lstrok: "Ł",
  Lt: "≪",
  Map: "⤅",
  Mcy: "М",
  MediumSpace: " ",
  Mellintrf: "ℳ",
  Mfr: "𝔐",
  MinusPlus: "∓",
  Mopf: "𝕄",
  Mscr: "ℳ",
  Mu: "Μ",
  NJcy: "Њ",
  Nacute: "Ń",
  Ncaron: "Ň",
  Ncedil: "Ņ",
  Ncy: "Н",
  NegativeMediumSpace: "​",
  NegativeThickSpace: "​",
  NegativeThinSpace: "​",
  NegativeVeryThinSpace: "​",
  NestedGreaterGreater: "≫",
  NestedLessLess: "≪",
  NewLine: "\n",
  Nfr: "𝔑",
  NoBreak: "⁠",
  NonBreakingSpace: "\xA0",
  Nopf: "ℕ",
  Not: "⫬",
  NotCongruent: "≢",
  NotCupCap: "≭",
  NotDoubleVerticalBar: "∦",
  NotElement: "∉",
  NotEqual: "≠",
  NotEqualTilde: "≂̸",
  NotExists: "∄",
  NotGreater: "≯",
  NotGreaterEqual: "≱",
  NotGreaterFullEqual: "≧̸",
  NotGreaterGreater: "≫̸",
  NotGreaterLess: "≹",
  NotGreaterSlantEqual: "⩾̸",
  NotGreaterTilde: "≵",
  NotHumpDownHump: "≎̸",
  NotHumpEqual: "≏̸",
  NotLeftTriangle: "⋪",
  NotLeftTriangleBar: "⧏̸",
  NotLeftTriangleEqual: "⋬",
  NotLess: "≮",
  NotLessEqual: "≰",
  NotLessGreater: "≸",
  NotLessLess: "≪̸",
  NotLessSlantEqual: "⩽̸",
  NotLessTilde: "≴",
  NotNestedGreaterGreater: "⪢̸",
  NotNestedLessLess: "⪡̸",
  NotPrecedes: "⊀",
  NotPrecedesEqual: "⪯̸",
  NotPrecedesSlantEqual: "⋠",
  NotReverseElement: "∌",
  NotRightTriangle: "⋫",
  NotRightTriangleBar: "⧐̸",
  NotRightTriangleEqual: "⋭",
  NotSquareSubset: "⊏̸",
  NotSquareSubsetEqual: "⋢",
  NotSquareSuperset: "⊐̸",
  NotSquareSupersetEqual: "⋣",
  NotSubset: "⊂⃒",
  NotSubsetEqual: "⊈",
  NotSucceeds: "⊁",
  NotSucceedsEqual: "⪰̸",
  NotSucceedsSlantEqual: "⋡",
  NotSucceedsTilde: "≿̸",
  NotSuperset: "⊃⃒",
  NotSupersetEqual: "⊉",
  NotTilde: "≁",
  NotTildeEqual: "≄",
  NotTildeFullEqual: "≇",
  NotTildeTilde: "≉",
  NotVerticalBar: "∤",
  Nscr: "𝒩",
  Ntilde: "Ñ",
  Nu: "Ν",
  OElig: "Œ",
  Oacute: "Ó",
  Ocirc: "Ô",
  Ocy: "О",
  Odblac: "Ő",
  Ofr: "𝔒",
  Ograve: "Ò",
  Omacr: "Ō",
  Omega: "Ω",
  Omicron: "Ο",
  Oopf: "𝕆",
  OpenCurlyDoubleQuote: "“",
  OpenCurlyQuote: "‘",
  Or: "⩔",
  Oscr: "𝒪",
  Oslash: "Ø",
  Otilde: "Õ",
  Otimes: "⨷",
  Ouml: "Ö",
  OverBar: "‾",
  OverBrace: "⏞",
  OverBracket: "⎴",
  OverParenthesis: "⏜",
  PartialD: "∂",
  Pcy: "П",
  Pfr: "𝔓",
  Phi: "Φ",
  Pi: "Π",
  PlusMinus: "±",
  Poincareplane: "ℌ",
  Popf: "ℙ",
  Pr: "⪻",
  Precedes: "≺",
  PrecedesEqual: "⪯",
  PrecedesSlantEqual: "≼",
  PrecedesTilde: "≾",
  Prime: "″",
  Product: "∏",
  Proportion: "∷",
  Proportional: "∝",
  Pscr: "𝒫",
  Psi: "Ψ",
  QUOT: '"',
  Qfr: "𝔔",
  Qopf: "ℚ",
  Qscr: "𝒬",
  RBarr: "⤐",
  REG: "®",
  Racute: "Ŕ",
  Rang: "⟫",
  Rarr: "↠",
  Rarrtl: "⤖",
  Rcaron: "Ř",
  Rcedil: "Ŗ",
  Rcy: "Р",
  Re: "ℜ",
  ReverseElement: "∋",
  ReverseEquilibrium: "⇋",
  ReverseUpEquilibrium: "⥯",
  Rfr: "ℜ",
  Rho: "Ρ",
  RightAngleBracket: "⟩",
  RightArrow: "→",
  RightArrowBar: "⇥",
  RightArrowLeftArrow: "⇄",
  RightCeiling: "⌉",
  RightDoubleBracket: "⟧",
  RightDownTeeVector: "⥝",
  RightDownVector: "⇂",
  RightDownVectorBar: "⥕",
  RightFloor: "⌋",
  RightTee: "⊢",
  RightTeeArrow: "↦",
  RightTeeVector: "⥛",
  RightTriangle: "⊳",
  RightTriangleBar: "⧐",
  RightTriangleEqual: "⊵",
  RightUpDownVector: "⥏",
  RightUpTeeVector: "⥜",
  RightUpVector: "↾",
  RightUpVectorBar: "⥔",
  RightVector: "⇀",
  RightVectorBar: "⥓",
  Rightarrow: "⇒",
  Ropf: "ℝ",
  RoundImplies: "⥰",
  Rrightarrow: "⇛",
  Rscr: "ℛ",
  Rsh: "↱",
  RuleDelayed: "⧴",
  SHCHcy: "Щ",
  SHcy: "Ш",
  SOFTcy: "Ь",
  Sacute: "Ś",
  Sc: "⪼",
  Scaron: "Š",
  Scedil: "Ş",
  Scirc: "Ŝ",
  Scy: "С",
  Sfr: "𝔖",
  ShortDownArrow: "↓",
  ShortLeftArrow: "←",
  ShortRightArrow: "→",
  ShortUpArrow: "↑",
  Sigma: "Σ",
  SmallCircle: "∘",
  Sopf: "𝕊",
  Sqrt: "√",
  Square: "□",
  SquareIntersection: "⊓",
  SquareSubset: "⊏",
  SquareSubsetEqual: "⊑",
  SquareSuperset: "⊐",
  SquareSupersetEqual: "⊒",
  SquareUnion: "⊔",
  Sscr: "𝒮",
  Star: "⋆",
  Sub: "⋐",
  Subset: "⋐",
  SubsetEqual: "⊆",
  Succeeds: "≻",
  SucceedsEqual: "⪰",
  SucceedsSlantEqual: "≽",
  SucceedsTilde: "≿",
  SuchThat: "∋",
  Sum: "∑",
  Sup: "⋑",
  Superset: "⊃",
  SupersetEqual: "⊇",
  Supset: "⋑",
  THORN: "Þ",
  TRADE: "™",
  TSHcy: "Ћ",
  TScy: "Ц",
  Tab: "	",
  Tau: "Τ",
  Tcaron: "Ť",
  Tcedil: "Ţ",
  Tcy: "Т",
  Tfr: "𝔗",
  Therefore: "∴",
  Theta: "Θ",
  ThickSpace: "  ",
  ThinSpace: " ",
  Tilde: "∼",
  TildeEqual: "≃",
  TildeFullEqual: "≅",
  TildeTilde: "≈",
  Topf: "𝕋",
  TripleDot: "⃛",
  Tscr: "𝒯",
  Tstrok: "Ŧ",
  Uacute: "Ú",
  Uarr: "↟",
  Uarrocir: "⥉",
  Ubrcy: "Ў",
  Ubreve: "Ŭ",
  Ucirc: "Û",
  Ucy: "У",
  Udblac: "Ű",
  Ufr: "𝔘",
  Ugrave: "Ù",
  Umacr: "Ū",
  UnderBar: "_",
  UnderBrace: "⏟",
  UnderBracket: "⎵",
  UnderParenthesis: "⏝",
  Union: "⋃",
  UnionPlus: "⊎",
  Uogon: "Ų",
  Uopf: "𝕌",
  UpArrow: "↑",
  UpArrowBar: "⤒",
  UpArrowDownArrow: "⇅",
  UpDownArrow: "↕",
  UpEquilibrium: "⥮",
  UpTee: "⊥",
  UpTeeArrow: "↥",
  Uparrow: "⇑",
  Updownarrow: "⇕",
  UpperLeftArrow: "↖",
  UpperRightArrow: "↗",
  Upsi: "ϒ",
  Upsilon: "Υ",
  Uring: "Ů",
  Uscr: "𝒰",
  Utilde: "Ũ",
  Uuml: "Ü",
  VDash: "⊫",
  Vbar: "⫫",
  Vcy: "В",
  Vdash: "⊩",
  Vdashl: "⫦",
  Vee: "⋁",
  Verbar: "‖",
  Vert: "‖",
  VerticalBar: "∣",
  VerticalLine: "|",
  VerticalSeparator: "❘",
  VerticalTilde: "≀",
  VeryThinSpace: " ",
  Vfr: "𝔙",
  Vopf: "𝕍",
  Vscr: "𝒱",
  Vvdash: "⊪",
  Wcirc: "Ŵ",
  Wedge: "⋀",
  Wfr: "𝔚",
  Wopf: "𝕎",
  Wscr: "𝒲",
  Xfr: "𝔛",
  Xi: "Ξ",
  Xopf: "𝕏",
  Xscr: "𝒳",
  YAcy: "Я",
  YIcy: "Ї",
  YUcy: "Ю",
  Yacute: "Ý",
  Ycirc: "Ŷ",
  Ycy: "Ы",
  Yfr: "𝔜",
  Yopf: "𝕐",
  Yscr: "𝒴",
  Yuml: "Ÿ",
  ZHcy: "Ж",
  Zacute: "Ź",
  Zcaron: "Ž",
  Zcy: "З",
  Zdot: "Ż",
  ZeroWidthSpace: "​",
  Zeta: "Ζ",
  Zfr: "ℨ",
  Zopf: "ℤ",
  Zscr: "𝒵",
  aacute: "á",
  abreve: "ă",
  ac: "∾",
  acE: "∾̳",
  acd: "∿",
  acirc: "â",
  acute: "´",
  acy: "а",
  aelig: "æ",
  af: "⁡",
  afr: "𝔞",
  agrave: "à",
  alefsym: "ℵ",
  aleph: "ℵ",
  alpha: "α",
  amacr: "ā",
  amalg: "⨿",
  amp: "&",
  and: "∧",
  andand: "⩕",
  andd: "⩜",
  andslope: "⩘",
  andv: "⩚",
  ang: "∠",
  ange: "⦤",
  angle: "∠",
  angmsd: "∡",
  angmsdaa: "⦨",
  angmsdab: "⦩",
  angmsdac: "⦪",
  angmsdad: "⦫",
  angmsdae: "⦬",
  angmsdaf: "⦭",
  angmsdag: "⦮",
  angmsdah: "⦯",
  angrt: "∟",
  angrtvb: "⊾",
  angrtvbd: "⦝",
  angsph: "∢",
  angst: "Å",
  angzarr: "⍼",
  aogon: "ą",
  aopf: "𝕒",
  ap: "≈",
  apE: "⩰",
  apacir: "⩯",
  ape: "≊",
  apid: "≋",
  apos: "'",
  approx: "≈",
  approxeq: "≊",
  aring: "å",
  ascr: "𝒶",
  ast: "*",
  asymp: "≈",
  asympeq: "≍",
  atilde: "ã",
  auml: "ä",
  awconint: "∳",
  awint: "⨑",
  bNot: "⫭",
  backcong: "≌",
  backepsilon: "϶",
  backprime: "‵",
  backsim: "∽",
  backsimeq: "⋍",
  barvee: "⊽",
  barwed: "⌅",
  barwedge: "⌅",
  bbrk: "⎵",
  bbrktbrk: "⎶",
  bcong: "≌",
  bcy: "б",
  bdquo: "„",
  becaus: "∵",
  because: "∵",
  bemptyv: "⦰",
  bepsi: "϶",
  bernou: "ℬ",
  beta: "β",
  beth: "ℶ",
  between: "≬",
  bfr: "𝔟",
  bigcap: "⋂",
  bigcirc: "◯",
  bigcup: "⋃",
  bigodot: "⨀",
  bigoplus: "⨁",
  bigotimes: "⨂",
  bigsqcup: "⨆",
  bigstar: "★",
  bigtriangledown: "▽",
  bigtriangleup: "△",
  biguplus: "⨄",
  bigvee: "⋁",
  bigwedge: "⋀",
  bkarow: "⤍",
  blacklozenge: "⧫",
  blacksquare: "▪",
  blacktriangle: "▴",
  blacktriangledown: "▾",
  blacktriangleleft: "◂",
  blacktriangleright: "▸",
  blank: "␣",
  blk12: "▒",
  blk14: "░",
  blk34: "▓",
  block: "█",
  bne: "=⃥",
  bnequiv: "≡⃥",
  bnot: "⌐",
  bopf: "𝕓",
  bot: "⊥",
  bottom: "⊥",
  bowtie: "⋈",
  boxDL: "╗",
  boxDR: "╔",
  boxDl: "╖",
  boxDr: "╓",
  boxH: "═",
  boxHD: "╦",
  boxHU: "╩",
  boxHd: "╤",
  boxHu: "╧",
  boxUL: "╝",
  boxUR: "╚",
  boxUl: "╜",
  boxUr: "╙",
  boxV: "║",
  boxVH: "╬",
  boxVL: "╣",
  boxVR: "╠",
  boxVh: "╫",
  boxVl: "╢",
  boxVr: "╟",
  boxbox: "⧉",
  boxdL: "╕",
  boxdR: "╒",
  boxdl: "┐",
  boxdr: "┌",
  boxh: "─",
  boxhD: "╥",
  boxhU: "╨",
  boxhd: "┬",
  boxhu: "┴",
  boxminus: "⊟",
  boxplus: "⊞",
  boxtimes: "⊠",
  boxuL: "╛",
  boxuR: "╘",
  boxul: "┘",
  boxur: "└",
  boxv: "│",
  boxvH: "╪",
  boxvL: "╡",
  boxvR: "╞",
  boxvh: "┼",
  boxvl: "┤",
  boxvr: "├",
  bprime: "‵",
  breve: "˘",
  brvbar: "¦",
  bscr: "𝒷",
  bsemi: "⁏",
  bsim: "∽",
  bsime: "⋍",
  bsol: "\\",
  bsolb: "⧅",
  bsolhsub: "⟈",
  bull: "•",
  bullet: "•",
  bump: "≎",
  bumpE: "⪮",
  bumpe: "≏",
  bumpeq: "≏",
  cacute: "ć",
  cap: "∩",
  capand: "⩄",
  capbrcup: "⩉",
  capcap: "⩋",
  capcup: "⩇",
  capdot: "⩀",
  caps: "∩︀",
  caret: "⁁",
  caron: "ˇ",
  ccaps: "⩍",
  ccaron: "č",
  ccedil: "ç",
  ccirc: "ĉ",
  ccups: "⩌",
  ccupssm: "⩐",
  cdot: "ċ",
  cedil: "¸",
  cemptyv: "⦲",
  cent: "¢",
  centerdot: "·",
  cfr: "𝔠",
  chcy: "ч",
  check: "✓",
  checkmark: "✓",
  chi: "χ",
  cir: "○",
  cirE: "⧃",
  circ: "ˆ",
  circeq: "≗",
  circlearrowleft: "↺",
  circlearrowright: "↻",
  circledR: "®",
  circledS: "Ⓢ",
  circledast: "⊛",
  circledcirc: "⊚",
  circleddash: "⊝",
  cire: "≗",
  cirfnint: "⨐",
  cirmid: "⫯",
  cirscir: "⧂",
  clubs: "♣",
  clubsuit: "♣",
  colon: ":",
  colone: "≔",
  coloneq: "≔",
  comma: ",",
  commat: "@",
  comp: "∁",
  compfn: "∘",
  complement: "∁",
  complexes: "ℂ",
  cong: "≅",
  congdot: "⩭",
  conint: "∮",
  copf: "𝕔",
  coprod: "∐",
  copy: "©",
  copysr: "℗",
  crarr: "↵",
  cross: "✗",
  cscr: "𝒸",
  csub: "⫏",
  csube: "⫑",
  csup: "⫐",
  csupe: "⫒",
  ctdot: "⋯",
  cudarrl: "⤸",
  cudarrr: "⤵",
  cuepr: "⋞",
  cuesc: "⋟",
  cularr: "↶",
  cularrp: "⤽",
  cup: "∪",
  cupbrcap: "⩈",
  cupcap: "⩆",
  cupcup: "⩊",
  cupdot: "⊍",
  cupor: "⩅",
  cups: "∪︀",
  curarr: "↷",
  curarrm: "⤼",
  curlyeqprec: "⋞",
  curlyeqsucc: "⋟",
  curlyvee: "⋎",
  curlywedge: "⋏",
  curren: "¤",
  curvearrowleft: "↶",
  curvearrowright: "↷",
  cuvee: "⋎",
  cuwed: "⋏",
  cwconint: "∲",
  cwint: "∱",
  cylcty: "⌭",
  dArr: "⇓",
  dHar: "⥥",
  dagger: "†",
  daleth: "ℸ",
  darr: "↓",
  dash: "‐",
  dashv: "⊣",
  dbkarow: "⤏",
  dblac: "˝",
  dcaron: "ď",
  dcy: "д",
  dd: "ⅆ",
  ddagger: "‡",
  ddarr: "⇊",
  ddotseq: "⩷",
  deg: "°",
  delta: "δ",
  demptyv: "⦱",
  dfisht: "⥿",
  dfr: "𝔡",
  dharl: "⇃",
  dharr: "⇂",
  diam: "⋄",
  diamond: "⋄",
  diamondsuit: "♦",
  diams: "♦",
  die: "¨",
  digamma: "ϝ",
  disin: "⋲",
  div: "÷",
  divide: "÷",
  divideontimes: "⋇",
  divonx: "⋇",
  djcy: "ђ",
  dlcorn: "⌞",
  dlcrop: "⌍",
  dollar: "$",
  dopf: "𝕕",
  dot: "˙",
  doteq: "≐",
  doteqdot: "≑",
  dotminus: "∸",
  dotplus: "∔",
  dotsquare: "⊡",
  doublebarwedge: "⌆",
  downarrow: "↓",
  downdownarrows: "⇊",
  downharpoonleft: "⇃",
  downharpoonright: "⇂",
  drbkarow: "⤐",
  drcorn: "⌟",
  drcrop: "⌌",
  dscr: "𝒹",
  dscy: "ѕ",
  dsol: "⧶",
  dstrok: "đ",
  dtdot: "⋱",
  dtri: "▿",
  dtrif: "▾",
  duarr: "⇵",
  duhar: "⥯",
  dwangle: "⦦",
  dzcy: "џ",
  dzigrarr: "⟿",
  eDDot: "⩷",
  eDot: "≑",
  eacute: "é",
  easter: "⩮",
  ecaron: "ě",
  ecir: "≖",
  ecirc: "ê",
  ecolon: "≕",
  ecy: "э",
  edot: "ė",
  ee: "ⅇ",
  efDot: "≒",
  efr: "𝔢",
  eg: "⪚",
  egrave: "è",
  egs: "⪖",
  egsdot: "⪘",
  el: "⪙",
  elinters: "⏧",
  ell: "ℓ",
  els: "⪕",
  elsdot: "⪗",
  emacr: "ē",
  empty: "∅",
  emptyset: "∅",
  emptyv: "∅",
  emsp13: " ",
  emsp14: " ",
  emsp: " ",
  eng: "ŋ",
  ensp: " ",
  eogon: "ę",
  eopf: "𝕖",
  epar: "⋕",
  eparsl: "⧣",
  eplus: "⩱",
  epsi: "ε",
  epsilon: "ε",
  epsiv: "ϵ",
  eqcirc: "≖",
  eqcolon: "≕",
  eqsim: "≂",
  eqslantgtr: "⪖",
  eqslantless: "⪕",
  equals: "=",
  equest: "≟",
  equiv: "≡",
  equivDD: "⩸",
  eqvparsl: "⧥",
  erDot: "≓",
  erarr: "⥱",
  escr: "ℯ",
  esdot: "≐",
  esim: "≂",
  eta: "η",
  eth: "ð",
  euml: "ë",
  euro: "€",
  excl: "!",
  exist: "∃",
  expectation: "ℰ",
  exponentiale: "ⅇ",
  fallingdotseq: "≒",
  fcy: "ф",
  female: "♀",
  ffilig: "ﬃ",
  fflig: "ﬀ",
  ffllig: "ﬄ",
  ffr: "𝔣",
  filig: "ﬁ",
  fjlig: "fj",
  flat: "♭",
  fllig: "ﬂ",
  fltns: "▱",
  fnof: "ƒ",
  fopf: "𝕗",
  forall: "∀",
  fork: "⋔",
  forkv: "⫙",
  fpartint: "⨍",
  frac12: "½",
  frac13: "⅓",
  frac14: "¼",
  frac15: "⅕",
  frac16: "⅙",
  frac18: "⅛",
  frac23: "⅔",
  frac25: "⅖",
  frac34: "¾",
  frac35: "⅗",
  frac38: "⅜",
  frac45: "⅘",
  frac56: "⅚",
  frac58: "⅝",
  frac78: "⅞",
  frasl: "⁄",
  frown: "⌢",
  fscr: "𝒻",
  gE: "≧",
  gEl: "⪌",
  gacute: "ǵ",
  gamma: "γ",
  gammad: "ϝ",
  gap: "⪆",
  gbreve: "ğ",
  gcirc: "ĝ",
  gcy: "г",
  gdot: "ġ",
  ge: "≥",
  gel: "⋛",
  geq: "≥",
  geqq: "≧",
  geqslant: "⩾",
  ges: "⩾",
  gescc: "⪩",
  gesdot: "⪀",
  gesdoto: "⪂",
  gesdotol: "⪄",
  gesl: "⋛︀",
  gesles: "⪔",
  gfr: "𝔤",
  gg: "≫",
  ggg: "⋙",
  gimel: "ℷ",
  gjcy: "ѓ",
  gl: "≷",
  glE: "⪒",
  gla: "⪥",
  glj: "⪤",
  gnE: "≩",
  gnap: "⪊",
  gnapprox: "⪊",
  gne: "⪈",
  gneq: "⪈",
  gneqq: "≩",
  gnsim: "⋧",
  gopf: "𝕘",
  grave: "`",
  gscr: "ℊ",
  gsim: "≳",
  gsime: "⪎",
  gsiml: "⪐",
  gt: ">",
  gtcc: "⪧",
  gtcir: "⩺",
  gtdot: "⋗",
  gtlPar: "⦕",
  gtquest: "⩼",
  gtrapprox: "⪆",
  gtrarr: "⥸",
  gtrdot: "⋗",
  gtreqless: "⋛",
  gtreqqless: "⪌",
  gtrless: "≷",
  gtrsim: "≳",
  gvertneqq: "≩︀",
  gvnE: "≩︀",
  hArr: "⇔",
  hairsp: " ",
  half: "½",
  hamilt: "ℋ",
  hardcy: "ъ",
  harr: "↔",
  harrcir: "⥈",
  harrw: "↭",
  hbar: "ℏ",
  hcirc: "ĥ",
  hearts: "♥",
  heartsuit: "♥",
  hellip: "…",
  hercon: "⊹",
  hfr: "𝔥",
  hksearow: "⤥",
  hkswarow: "⤦",
  hoarr: "⇿",
  homtht: "∻",
  hookleftarrow: "↩",
  hookrightarrow: "↪",
  hopf: "𝕙",
  horbar: "―",
  hscr: "𝒽",
  hslash: "ℏ",
  hstrok: "ħ",
  hybull: "⁃",
  hyphen: "‐",
  iacute: "í",
  ic: "⁣",
  icirc: "î",
  icy: "и",
  iecy: "е",
  iexcl: "¡",
  iff: "⇔",
  ifr: "𝔦",
  igrave: "ì",
  ii: "ⅈ",
  iiiint: "⨌",
  iiint: "∭",
  iinfin: "⧜",
  iiota: "℩",
  ijlig: "ĳ",
  imacr: "ī",
  image: "ℑ",
  imagline: "ℐ",
  imagpart: "ℑ",
  imath: "ı",
  imof: "⊷",
  imped: "Ƶ",
  in: "∈",
  incare: "℅",
  infin: "∞",
  infintie: "⧝",
  inodot: "ı",
  int: "∫",
  intcal: "⊺",
  integers: "ℤ",
  intercal: "⊺",
  intlarhk: "⨗",
  intprod: "⨼",
  iocy: "ё",
  iogon: "į",
  iopf: "𝕚",
  iota: "ι",
  iprod: "⨼",
  iquest: "¿",
  iscr: "𝒾",
  isin: "∈",
  isinE: "⋹",
  isindot: "⋵",
  isins: "⋴",
  isinsv: "⋳",
  isinv: "∈",
  it: "⁢",
  itilde: "ĩ",
  iukcy: "і",
  iuml: "ï",
  jcirc: "ĵ",
  jcy: "й",
  jfr: "𝔧",
  jmath: "ȷ",
  jopf: "𝕛",
  jscr: "𝒿",
  jsercy: "ј",
  jukcy: "є",
  kappa: "κ",
  kappav: "ϰ",
  kcedil: "ķ",
  kcy: "к",
  kfr: "𝔨",
  kgreen: "ĸ",
  khcy: "х",
  kjcy: "ќ",
  kopf: "𝕜",
  kscr: "𝓀",
  lAarr: "⇚",
  lArr: "⇐",
  lAtail: "⤛",
  lBarr: "⤎",
  lE: "≦",
  lEg: "⪋",
  lHar: "⥢",
  lacute: "ĺ",
  laemptyv: "⦴",
  lagran: "ℒ",
  lambda: "λ",
  lang: "⟨",
  langd: "⦑",
  langle: "⟨",
  lap: "⪅",
  laquo: "«",
  larr: "←",
  larrb: "⇤",
  larrbfs: "⤟",
  larrfs: "⤝",
  larrhk: "↩",
  larrlp: "↫",
  larrpl: "⤹",
  larrsim: "⥳",
  larrtl: "↢",
  lat: "⪫",
  latail: "⤙",
  late: "⪭",
  lates: "⪭︀",
  lbarr: "⤌",
  lbbrk: "❲",
  lbrace: "{",
  lbrack: "[",
  lbrke: "⦋",
  lbrksld: "⦏",
  lbrkslu: "⦍",
  lcaron: "ľ",
  lcedil: "ļ",
  lceil: "⌈",
  lcub: "{",
  lcy: "л",
  ldca: "⤶",
  ldquo: "“",
  ldquor: "„",
  ldrdhar: "⥧",
  ldrushar: "⥋",
  ldsh: "↲",
  le: "≤",
  leftarrow: "←",
  leftarrowtail: "↢",
  leftharpoondown: "↽",
  leftharpoonup: "↼",
  leftleftarrows: "⇇",
  leftrightarrow: "↔",
  leftrightarrows: "⇆",
  leftrightharpoons: "⇋",
  leftrightsquigarrow: "↭",
  leftthreetimes: "⋋",
  leg: "⋚",
  leq: "≤",
  leqq: "≦",
  leqslant: "⩽",
  les: "⩽",
  lescc: "⪨",
  lesdot: "⩿",
  lesdoto: "⪁",
  lesdotor: "⪃",
  lesg: "⋚︀",
  lesges: "⪓",
  lessapprox: "⪅",
  lessdot: "⋖",
  lesseqgtr: "⋚",
  lesseqqgtr: "⪋",
  lessgtr: "≶",
  lesssim: "≲",
  lfisht: "⥼",
  lfloor: "⌊",
  lfr: "𝔩",
  lg: "≶",
  lgE: "⪑",
  lhard: "↽",
  lharu: "↼",
  lharul: "⥪",
  lhblk: "▄",
  ljcy: "љ",
  ll: "≪",
  llarr: "⇇",
  llcorner: "⌞",
  llhard: "⥫",
  lltri: "◺",
  lmidot: "ŀ",
  lmoust: "⎰",
  lmoustache: "⎰",
  lnE: "≨",
  lnap: "⪉",
  lnapprox: "⪉",
  lne: "⪇",
  lneq: "⪇",
  lneqq: "≨",
  lnsim: "⋦",
  loang: "⟬",
  loarr: "⇽",
  lobrk: "⟦",
  longleftarrow: "⟵",
  longleftrightarrow: "⟷",
  longmapsto: "⟼",
  longrightarrow: "⟶",
  looparrowleft: "↫",
  looparrowright: "↬",
  lopar: "⦅",
  lopf: "𝕝",
  loplus: "⨭",
  lotimes: "⨴",
  lowast: "∗",
  lowbar: "_",
  loz: "◊",
  lozenge: "◊",
  lozf: "⧫",
  lpar: "(",
  lparlt: "⦓",
  lrarr: "⇆",
  lrcorner: "⌟",
  lrhar: "⇋",
  lrhard: "⥭",
  lrm: "‎",
  lrtri: "⊿",
  lsaquo: "‹",
  lscr: "𝓁",
  lsh: "↰",
  lsim: "≲",
  lsime: "⪍",
  lsimg: "⪏",
  lsqb: "[",
  lsquo: "‘",
  lsquor: "‚",
  lstrok: "ł",
  lt: "<",
  ltcc: "⪦",
  ltcir: "⩹",
  ltdot: "⋖",
  lthree: "⋋",
  ltimes: "⋉",
  ltlarr: "⥶",
  ltquest: "⩻",
  ltrPar: "⦖",
  ltri: "◃",
  ltrie: "⊴",
  ltrif: "◂",
  lurdshar: "⥊",
  luruhar: "⥦",
  lvertneqq: "≨︀",
  lvnE: "≨︀",
  mDDot: "∺",
  macr: "¯",
  male: "♂",
  malt: "✠",
  maltese: "✠",
  map: "↦",
  mapsto: "↦",
  mapstodown: "↧",
  mapstoleft: "↤",
  mapstoup: "↥",
  marker: "▮",
  mcomma: "⨩",
  mcy: "м",
  mdash: "—",
  measuredangle: "∡",
  mfr: "𝔪",
  mho: "℧",
  micro: "µ",
  mid: "∣",
  midast: "*",
  midcir: "⫰",
  middot: "·",
  minus: "−",
  minusb: "⊟",
  minusd: "∸",
  minusdu: "⨪",
  mlcp: "⫛",
  mldr: "…",
  mnplus: "∓",
  models: "⊧",
  mopf: "𝕞",
  mp: "∓",
  mscr: "𝓂",
  mstpos: "∾",
  mu: "μ",
  multimap: "⊸",
  mumap: "⊸",
  nGg: "⋙̸",
  nGt: "≫⃒",
  nGtv: "≫̸",
  nLeftarrow: "⇍",
  nLeftrightarrow: "⇎",
  nLl: "⋘̸",
  nLt: "≪⃒",
  nLtv: "≪̸",
  nRightarrow: "⇏",
  nVDash: "⊯",
  nVdash: "⊮",
  nabla: "∇",
  nacute: "ń",
  nang: "∠⃒",
  nap: "≉",
  napE: "⩰̸",
  napid: "≋̸",
  napos: "ŉ",
  napprox: "≉",
  natur: "♮",
  natural: "♮",
  naturals: "ℕ",
  nbsp: "\xA0",
  nbump: "≎̸",
  nbumpe: "≏̸",
  ncap: "⩃",
  ncaron: "ň",
  ncedil: "ņ",
  ncong: "≇",
  ncongdot: "⩭̸",
  ncup: "⩂",
  ncy: "н",
  ndash: "–",
  ne: "≠",
  neArr: "⇗",
  nearhk: "⤤",
  nearr: "↗",
  nearrow: "↗",
  nedot: "≐̸",
  nequiv: "≢",
  nesear: "⤨",
  nesim: "≂̸",
  nexist: "∄",
  nexists: "∄",
  nfr: "𝔫",
  ngE: "≧̸",
  nge: "≱",
  ngeq: "≱",
  ngeqq: "≧̸",
  ngeqslant: "⩾̸",
  nges: "⩾̸",
  ngsim: "≵",
  ngt: "≯",
  ngtr: "≯",
  nhArr: "⇎",
  nharr: "↮",
  nhpar: "⫲",
  ni: "∋",
  nis: "⋼",
  nisd: "⋺",
  niv: "∋",
  njcy: "њ",
  nlArr: "⇍",
  nlE: "≦̸",
  nlarr: "↚",
  nldr: "‥",
  nle: "≰",
  nleftarrow: "↚",
  nleftrightarrow: "↮",
  nleq: "≰",
  nleqq: "≦̸",
  nleqslant: "⩽̸",
  nles: "⩽̸",
  nless: "≮",
  nlsim: "≴",
  nlt: "≮",
  nltri: "⋪",
  nltrie: "⋬",
  nmid: "∤",
  nopf: "𝕟",
  not: "¬",
  notin: "∉",
  notinE: "⋹̸",
  notindot: "⋵̸",
  notinva: "∉",
  notinvb: "⋷",
  notinvc: "⋶",
  notni: "∌",
  notniva: "∌",
  notnivb: "⋾",
  notnivc: "⋽",
  npar: "∦",
  nparallel: "∦",
  nparsl: "⫽⃥",
  npart: "∂̸",
  npolint: "⨔",
  npr: "⊀",
  nprcue: "⋠",
  npre: "⪯̸",
  nprec: "⊀",
  npreceq: "⪯̸",
  nrArr: "⇏",
  nrarr: "↛",
  nrarrc: "⤳̸",
  nrarrw: "↝̸",
  nrightarrow: "↛",
  nrtri: "⋫",
  nrtrie: "⋭",
  nsc: "⊁",
  nsccue: "⋡",
  nsce: "⪰̸",
  nscr: "𝓃",
  nshortmid: "∤",
  nshortparallel: "∦",
  nsim: "≁",
  nsime: "≄",
  nsimeq: "≄",
  nsmid: "∤",
  nspar: "∦",
  nsqsube: "⋢",
  nsqsupe: "⋣",
  nsub: "⊄",
  nsubE: "⫅̸",
  nsube: "⊈",
  nsubset: "⊂⃒",
  nsubseteq: "⊈",
  nsubseteqq: "⫅̸",
  nsucc: "⊁",
  nsucceq: "⪰̸",
  nsup: "⊅",
  nsupE: "⫆̸",
  nsupe: "⊉",
  nsupset: "⊃⃒",
  nsupseteq: "⊉",
  nsupseteqq: "⫆̸",
  ntgl: "≹",
  ntilde: "ñ",
  ntlg: "≸",
  ntriangleleft: "⋪",
  ntrianglelefteq: "⋬",
  ntriangleright: "⋫",
  ntrianglerighteq: "⋭",
  nu: "ν",
  num: "#",
  numero: "№",
  numsp: " ",
  nvDash: "⊭",
  nvHarr: "⤄",
  nvap: "≍⃒",
  nvdash: "⊬",
  nvge: "≥⃒",
  nvgt: ">⃒",
  nvinfin: "⧞",
  nvlArr: "⤂",
  nvle: "≤⃒",
  nvlt: "<⃒",
  nvltrie: "⊴⃒",
  nvrArr: "⤃",
  nvrtrie: "⊵⃒",
  nvsim: "∼⃒",
  nwArr: "⇖",
  nwarhk: "⤣",
  nwarr: "↖",
  nwarrow: "↖",
  nwnear: "⤧",
  oS: "Ⓢ",
  oacute: "ó",
  oast: "⊛",
  ocir: "⊚",
  ocirc: "ô",
  ocy: "о",
  odash: "⊝",
  odblac: "ő",
  odiv: "⨸",
  odot: "⊙",
  odsold: "⦼",
  oelig: "œ",
  ofcir: "⦿",
  ofr: "𝔬",
  ogon: "˛",
  ograve: "ò",
  ogt: "⧁",
  ohbar: "⦵",
  ohm: "Ω",
  oint: "∮",
  olarr: "↺",
  olcir: "⦾",
  olcross: "⦻",
  oline: "‾",
  olt: "⧀",
  omacr: "ō",
  omega: "ω",
  omicron: "ο",
  omid: "⦶",
  ominus: "⊖",
  oopf: "𝕠",
  opar: "⦷",
  operp: "⦹",
  oplus: "⊕",
  or: "∨",
  orarr: "↻",
  ord: "⩝",
  order: "ℴ",
  orderof: "ℴ",
  ordf: "ª",
  ordm: "º",
  origof: "⊶",
  oror: "⩖",
  orslope: "⩗",
  orv: "⩛",
  oscr: "ℴ",
  oslash: "ø",
  osol: "⊘",
  otilde: "õ",
  otimes: "⊗",
  otimesas: "⨶",
  ouml: "ö",
  ovbar: "⌽",
  par: "∥",
  para: "¶",
  parallel: "∥",
  parsim: "⫳",
  parsl: "⫽",
  part: "∂",
  pcy: "п",
  percnt: "%",
  period: ".",
  permil: "‰",
  perp: "⊥",
  pertenk: "‱",
  pfr: "𝔭",
  phi: "φ",
  phiv: "ϕ",
  phmmat: "ℳ",
  phone: "☎",
  pi: "π",
  pitchfork: "⋔",
  piv: "ϖ",
  planck: "ℏ",
  planckh: "ℎ",
  plankv: "ℏ",
  plus: "+",
  plusacir: "⨣",
  plusb: "⊞",
  pluscir: "⨢",
  plusdo: "∔",
  plusdu: "⨥",
  pluse: "⩲",
  plusmn: "±",
  plussim: "⨦",
  plustwo: "⨧",
  pm: "±",
  pointint: "⨕",
  popf: "𝕡",
  pound: "£",
  pr: "≺",
  prE: "⪳",
  prap: "⪷",
  prcue: "≼",
  pre: "⪯",
  prec: "≺",
  precapprox: "⪷",
  preccurlyeq: "≼",
  preceq: "⪯",
  precnapprox: "⪹",
  precneqq: "⪵",
  precnsim: "⋨",
  precsim: "≾",
  prime: "′",
  primes: "ℙ",
  prnE: "⪵",
  prnap: "⪹",
  prnsim: "⋨",
  prod: "∏",
  profalar: "⌮",
  profline: "⌒",
  profsurf: "⌓",
  prop: "∝",
  propto: "∝",
  prsim: "≾",
  prurel: "⊰",
  pscr: "𝓅",
  psi: "ψ",
  puncsp: " ",
  qfr: "𝔮",
  qint: "⨌",
  qopf: "𝕢",
  qprime: "⁗",
  qscr: "𝓆",
  quaternions: "ℍ",
  quatint: "⨖",
  quest: "?",
  questeq: "≟",
  quot: '"',
  rAarr: "⇛",
  rArr: "⇒",
  rAtail: "⤜",
  rBarr: "⤏",
  rHar: "⥤",
  race: "∽̱",
  racute: "ŕ",
  radic: "√",
  raemptyv: "⦳",
  rang: "⟩",
  rangd: "⦒",
  range: "⦥",
  rangle: "⟩",
  raquo: "»",
  rarr: "→",
  rarrap: "⥵",
  rarrb: "⇥",
  rarrbfs: "⤠",
  rarrc: "⤳",
  rarrfs: "⤞",
  rarrhk: "↪",
  rarrlp: "↬",
  rarrpl: "⥅",
  rarrsim: "⥴",
  rarrtl: "↣",
  rarrw: "↝",
  ratail: "⤚",
  ratio: "∶",
  rationals: "ℚ",
  rbarr: "⤍",
  rbbrk: "❳",
  rbrace: "}",
  rbrack: "]",
  rbrke: "⦌",
  rbrksld: "⦎",
  rbrkslu: "⦐",
  rcaron: "ř",
  rcedil: "ŗ",
  rceil: "⌉",
  rcub: "}",
  rcy: "р",
  rdca: "⤷",
  rdldhar: "⥩",
  rdquo: "”",
  rdquor: "”",
  rdsh: "↳",
  real: "ℜ",
  realine: "ℛ",
  realpart: "ℜ",
  reals: "ℝ",
  rect: "▭",
  reg: "®",
  rfisht: "⥽",
  rfloor: "⌋",
  rfr: "𝔯",
  rhard: "⇁",
  rharu: "⇀",
  rharul: "⥬",
  rho: "ρ",
  rhov: "ϱ",
  rightarrow: "→",
  rightarrowtail: "↣",
  rightharpoondown: "⇁",
  rightharpoonup: "⇀",
  rightleftarrows: "⇄",
  rightleftharpoons: "⇌",
  rightrightarrows: "⇉",
  rightsquigarrow: "↝",
  rightthreetimes: "⋌",
  ring: "˚",
  risingdotseq: "≓",
  rlarr: "⇄",
  rlhar: "⇌",
  rlm: "‏",
  rmoust: "⎱",
  rmoustache: "⎱",
  rnmid: "⫮",
  roang: "⟭",
  roarr: "⇾",
  robrk: "⟧",
  ropar: "⦆",
  ropf: "𝕣",
  roplus: "⨮",
  rotimes: "⨵",
  rpar: ")",
  rpargt: "⦔",
  rppolint: "⨒",
  rrarr: "⇉",
  rsaquo: "›",
  rscr: "𝓇",
  rsh: "↱",
  rsqb: "]",
  rsquo: "’",
  rsquor: "’",
  rthree: "⋌",
  rtimes: "⋊",
  rtri: "▹",
  rtrie: "⊵",
  rtrif: "▸",
  rtriltri: "⧎",
  ruluhar: "⥨",
  rx: "℞",
  sacute: "ś",
  sbquo: "‚",
  sc: "≻",
  scE: "⪴",
  scap: "⪸",
  scaron: "š",
  sccue: "≽",
  sce: "⪰",
  scedil: "ş",
  scirc: "ŝ",
  scnE: "⪶",
  scnap: "⪺",
  scnsim: "⋩",
  scpolint: "⨓",
  scsim: "≿",
  scy: "с",
  sdot: "⋅",
  sdotb: "⊡",
  sdote: "⩦",
  seArr: "⇘",
  searhk: "⤥",
  searr: "↘",
  searrow: "↘",
  sect: "§",
  semi: ";",
  seswar: "⤩",
  setminus: "∖",
  setmn: "∖",
  sext: "✶",
  sfr: "𝔰",
  sfrown: "⌢",
  sharp: "♯",
  shchcy: "щ",
  shcy: "ш",
  shortmid: "∣",
  shortparallel: "∥",
  shy: "­",
  sigma: "σ",
  sigmaf: "ς",
  sigmav: "ς",
  sim: "∼",
  simdot: "⩪",
  sime: "≃",
  simeq: "≃",
  simg: "⪞",
  simgE: "⪠",
  siml: "⪝",
  simlE: "⪟",
  simne: "≆",
  simplus: "⨤",
  simrarr: "⥲",
  slarr: "←",
  smallsetminus: "∖",
  smashp: "⨳",
  smeparsl: "⧤",
  smid: "∣",
  smile: "⌣",
  smt: "⪪",
  smte: "⪬",
  smtes: "⪬︀",
  softcy: "ь",
  sol: "/",
  solb: "⧄",
  solbar: "⌿",
  sopf: "𝕤",
  spades: "♠",
  spadesuit: "♠",
  spar: "∥",
  sqcap: "⊓",
  sqcaps: "⊓︀",
  sqcup: "⊔",
  sqcups: "⊔︀",
  sqsub: "⊏",
  sqsube: "⊑",
  sqsubset: "⊏",
  sqsubseteq: "⊑",
  sqsup: "⊐",
  sqsupe: "⊒",
  sqsupset: "⊐",
  sqsupseteq: "⊒",
  squ: "□",
  square: "□",
  squarf: "▪",
  squf: "▪",
  srarr: "→",
  sscr: "𝓈",
  ssetmn: "∖",
  ssmile: "⌣",
  sstarf: "⋆",
  star: "☆",
  starf: "★",
  straightepsilon: "ϵ",
  straightphi: "ϕ",
  strns: "¯",
  sub: "⊂",
  subE: "⫅",
  subdot: "⪽",
  sube: "⊆",
  subedot: "⫃",
  submult: "⫁",
  subnE: "⫋",
  subne: "⊊",
  subplus: "⪿",
  subrarr: "⥹",
  subset: "⊂",
  subseteq: "⊆",
  subseteqq: "⫅",
  subsetneq: "⊊",
  subsetneqq: "⫋",
  subsim: "⫇",
  subsub: "⫕",
  subsup: "⫓",
  succ: "≻",
  succapprox: "⪸",
  succcurlyeq: "≽",
  succeq: "⪰",
  succnapprox: "⪺",
  succneqq: "⪶",
  succnsim: "⋩",
  succsim: "≿",
  sum: "∑",
  sung: "♪",
  sup1: "¹",
  sup2: "²",
  sup3: "³",
  sup: "⊃",
  supE: "⫆",
  supdot: "⪾",
  supdsub: "⫘",
  supe: "⊇",
  supedot: "⫄",
  suphsol: "⟉",
  suphsub: "⫗",
  suplarr: "⥻",
  supmult: "⫂",
  supnE: "⫌",
  supne: "⊋",
  supplus: "⫀",
  supset: "⊃",
  supseteq: "⊇",
  supseteqq: "⫆",
  supsetneq: "⊋",
  supsetneqq: "⫌",
  supsim: "⫈",
  supsub: "⫔",
  supsup: "⫖",
  swArr: "⇙",
  swarhk: "⤦",
  swarr: "↙",
  swarrow: "↙",
  swnwar: "⤪",
  szlig: "ß",
  target: "⌖",
  tau: "τ",
  tbrk: "⎴",
  tcaron: "ť",
  tcedil: "ţ",
  tcy: "т",
  tdot: "⃛",
  telrec: "⌕",
  tfr: "𝔱",
  there4: "∴",
  therefore: "∴",
  theta: "θ",
  thetasym: "ϑ",
  thetav: "ϑ",
  thickapprox: "≈",
  thicksim: "∼",
  thinsp: " ",
  thkap: "≈",
  thksim: "∼",
  thorn: "þ",
  tilde: "˜",
  times: "×",
  timesb: "⊠",
  timesbar: "⨱",
  timesd: "⨰",
  tint: "∭",
  toea: "⤨",
  top: "⊤",
  topbot: "⌶",
  topcir: "⫱",
  topf: "𝕥",
  topfork: "⫚",
  tosa: "⤩",
  tprime: "‴",
  trade: "™",
  triangle: "▵",
  triangledown: "▿",
  triangleleft: "◃",
  trianglelefteq: "⊴",
  triangleq: "≜",
  triangleright: "▹",
  trianglerighteq: "⊵",
  tridot: "◬",
  trie: "≜",
  triminus: "⨺",
  triplus: "⨹",
  trisb: "⧍",
  tritime: "⨻",
  trpezium: "⏢",
  tscr: "𝓉",
  tscy: "ц",
  tshcy: "ћ",
  tstrok: "ŧ",
  twixt: "≬",
  twoheadleftarrow: "↞",
  twoheadrightarrow: "↠",
  uArr: "⇑",
  uHar: "⥣",
  uacute: "ú",
  uarr: "↑",
  ubrcy: "ў",
  ubreve: "ŭ",
  ucirc: "û",
  ucy: "у",
  udarr: "⇅",
  udblac: "ű",
  udhar: "⥮",
  ufisht: "⥾",
  ufr: "𝔲",
  ugrave: "ù",
  uharl: "↿",
  uharr: "↾",
  uhblk: "▀",
  ulcorn: "⌜",
  ulcorner: "⌜",
  ulcrop: "⌏",
  ultri: "◸",
  umacr: "ū",
  uml: "¨",
  uogon: "ų",
  uopf: "𝕦",
  uparrow: "↑",
  updownarrow: "↕",
  upharpoonleft: "↿",
  upharpoonright: "↾",
  uplus: "⊎",
  upsi: "υ",
  upsih: "ϒ",
  upsilon: "υ",
  upuparrows: "⇈",
  urcorn: "⌝",
  urcorner: "⌝",
  urcrop: "⌎",
  uring: "ů",
  urtri: "◹",
  uscr: "𝓊",
  utdot: "⋰",
  utilde: "ũ",
  utri: "▵",
  utrif: "▴",
  uuarr: "⇈",
  uuml: "ü",
  uwangle: "⦧",
  vArr: "⇕",
  vBar: "⫨",
  vBarv: "⫩",
  vDash: "⊨",
  vangrt: "⦜",
  varepsilon: "ϵ",
  varkappa: "ϰ",
  varnothing: "∅",
  varphi: "ϕ",
  varpi: "ϖ",
  varpropto: "∝",
  varr: "↕",
  varrho: "ϱ",
  varsigma: "ς",
  varsubsetneq: "⊊︀",
  varsubsetneqq: "⫋︀",
  varsupsetneq: "⊋︀",
  varsupsetneqq: "⫌︀",
  vartheta: "ϑ",
  vartriangleleft: "⊲",
  vartriangleright: "⊳",
  vcy: "в",
  vdash: "⊢",
  vee: "∨",
  veebar: "⊻",
  veeeq: "≚",
  vellip: "⋮",
  verbar: "|",
  vert: "|",
  vfr: "𝔳",
  vltri: "⊲",
  vnsub: "⊂⃒",
  vnsup: "⊃⃒",
  vopf: "𝕧",
  vprop: "∝",
  vrtri: "⊳",
  vscr: "𝓋",
  vsubnE: "⫋︀",
  vsubne: "⊊︀",
  vsupnE: "⫌︀",
  vsupne: "⊋︀",
  vzigzag: "⦚",
  wcirc: "ŵ",
  wedbar: "⩟",
  wedge: "∧",
  wedgeq: "≙",
  weierp: "℘",
  wfr: "𝔴",
  wopf: "𝕨",
  wp: "℘",
  wr: "≀",
  wreath: "≀",
  wscr: "𝓌",
  xcap: "⋂",
  xcirc: "◯",
  xcup: "⋃",
  xdtri: "▽",
  xfr: "𝔵",
  xhArr: "⟺",
  xharr: "⟷",
  xi: "ξ",
  xlArr: "⟸",
  xlarr: "⟵",
  xmap: "⟼",
  xnis: "⋻",
  xodot: "⨀",
  xopf: "𝕩",
  xoplus: "⨁",
  xotime: "⨂",
  xrArr: "⟹",
  xrarr: "⟶",
  xscr: "𝓍",
  xsqcup: "⨆",
  xuplus: "⨄",
  xutri: "△",
  xvee: "⋁",
  xwedge: "⋀",
  yacute: "ý",
  yacy: "я",
  ycirc: "ŷ",
  ycy: "ы",
  yen: "¥",
  yfr: "𝔶",
  yicy: "ї",
  yopf: "𝕪",
  yscr: "𝓎",
  yucy: "ю",
  yuml: "ÿ",
  zacute: "ź",
  zcaron: "ž",
  zcy: "з",
  zdot: "ż",
  zeetrf: "ℨ",
  zeta: "ζ",
  zfr: "𝔷",
  zhcy: "ж",
  zigrarr: "⇝",
  zopf: "𝕫",
  zscr: "𝓏",
  zwj: "‍",
  zwnj: "‌",
};
var nt = {
  0: 65533,
  128: 8364,
  130: 8218,
  131: 402,
  132: 8222,
  133: 8230,
  134: 8224,
  135: 8225,
  136: 710,
  137: 8240,
  138: 352,
  139: 8249,
  140: 338,
  142: 381,
  145: 8216,
  146: 8217,
  147: 8220,
  148: 8221,
  149: 8226,
  150: 8211,
  151: 8212,
  152: 732,
  153: 8482,
  154: 353,
  155: 8250,
  156: 339,
  158: 382,
  159: 376,
};
function rt(e) {
  return e.replace(/&(?:[a-zA-Z]+|#[xX][\da-fA-F]+|#\d+);/g, (e) => {
    if (e.charAt(1) === "#") {
      const t = e.charAt(2);
      return it(
        t === "X" || t === "x"
          ? parseInt(e.slice(3), 16)
          : parseInt(e.slice(2), 10),
      );
    }
    return Ke(tt, e.slice(1, -1)) ?? e;
  });
}
function it(e) {
  return (e >= 55296 && e <= 57343) || e > 1114111
    ? "�"
    : String.fromCodePoint(Ke(nt, e) ?? e);
}
function at(e, t) {
  return (
    (e.startIndex = e.tokenIndex = e.index),
    (e.startColumn = e.tokenColumn = e.column),
    (e.startLine = e.tokenLine = e.line),
    e.setToken(b$1[e.currentChar] & 8192 ? ot(e) : et(e, t, 0)),
    e.getToken()
  );
}
function ot(e) {
  let t = e.currentChar,
    n = _$1(e),
    r = e.index;
  for (; n !== t; ) e.index >= e.end && e.report(16), (n = _$1(e));
  return (
    n !== t && e.report(16),
    (e.tokenValue = e.source.slice(r, e.index)),
    _$1(e),
    e.options.raw && (e.tokenRaw = e.source.slice(e.tokenIndex, e.index)),
    134283267
  );
}
function j(e) {
  if (
    ((e.startIndex = e.tokenIndex = e.index),
    (e.startColumn = e.tokenColumn = e.column),
    (e.startLine = e.tokenLine = e.line),
    e.index >= e.end)
  ) {
    e.setToken(1048576);
    return;
  }
  if (e.currentChar === 60) {
    _$1(e), e.setToken(8456256);
    return;
  }
  if (e.currentChar === 123) {
    _$1(e), e.setToken(2162700);
    return;
  }
  let t = 0;
  for (; e.index < e.end; ) {
    const n = b$1[e.source.charCodeAt(e.index)];
    if (
      (n & 1024
        ? ((t |= 5), v$1(e))
        : n & 2048
          ? (fe(e, t), (t = (t & -5) | 1))
          : _$1(e),
      b$1[e.currentChar] & 16384)
    )
      break;
  }
  e.tokenIndex === e.index && e.report(0);
  const n = e.source.slice(e.tokenIndex, e.index);
  e.options.raw && (e.tokenRaw = n), (e.tokenValue = rt(n)), e.setToken(137);
}
function st(e) {
  if ((e.getToken() & 143360) === 143360) {
    let { index: t } = e,
      n = e.currentChar;
    for (; b$1[n] & 32770; ) n = _$1(e);
    (e.tokenValue += e.source.slice(t, e.index)), e.setToken(208897, !0);
  }
  return e.getToken();
}
var ct = class e {
  parser;
  type;
  parent;
  scopeError;
  variableBindings = /* @__PURE__ */ new Map();
  constructor(e, t = 2, n) {
    (this.parser = e), (this.type = t), (this.parent = n);
  }
  createChildScope(t) {
    return new e(this.parser, t, this);
  }
  addVarOrBlock(e, t, n, r) {
    n & 4 ? this.addVarName(e, t, n) : this.addBlockName(e, t, n, r),
      r & 64 && this.parser.declareUnboundVariable(t);
  }
  addVarName(e, t, n) {
    let { parser: r } = this,
      i = this;
    for (; i && !(i.type & 128); ) {
      const { variableBindings: a } = i,
        o = a.get(t);
      o &&
        o & 248 &&
        ((r.options.webcompat &&
          !(e & 1) &&
          ((n & 128 && o & 68) || (o & 128 && n & 68))) ||
          r.report(145, t)),
        i === this && o && o & 1 && n & 1 && i.recordScopeError(145, t),
        o && (o & 256 || (o & 512 && !r.options.webcompat)) && r.report(145, t),
        i.variableBindings.set(t, n),
        (i = i.parent);
    }
  }
  hasVariable(e) {
    return this.variableBindings.has(e);
  }
  addBlockName(e, t, n, r) {
    const { parser: i } = this,
      a = this.variableBindings.get(t);
    a &&
      !(a & 2) &&
      (n & 1
        ? this.recordScopeError(145, t)
        : (i.options.webcompat && !(e & 1) && r & 2 && a === 64 && n === 64) ||
          i.report(145, t)),
      this.type & 64 &&
        this.parent?.hasVariable(t) &&
        !(this.parent.variableBindings.get(t) & 2) &&
        i.report(145, t),
      this.type & 512 &&
        a &&
        !(a & 2) &&
        n & 1 &&
        this.recordScopeError(145, t),
      this.type & 32 &&
        this.parent.variableBindings.get(t) & 768 &&
        i.report(159, t),
      this.variableBindings.set(t, n);
  }
  recordScopeError(e, ...t) {
    this.scopeError = {
      type: e,
      params: t,
      start: this.parser.tokenStart,
      end: this.parser.currentLocation,
    };
  }
  reportScopeError() {
    const { scopeError: e } = this;
    if (e) throw new C$1(e.start, e.end, e.type, ...e.params);
  }
};
function lt(e, t, n) {
  const r = e.createScope().createChildScope(512);
  return r.addBlockName(t, n, 1, 0), r;
}
var ut = class {
  parser;
  parent;
  refs = Object.create(null);
  privateIdentifiers = /* @__PURE__ */ new Map();
  constructor(e, t) {
    (this.parser = e), (this.parent = t);
  }
  addPrivateIdentifier(e, t) {
    let { privateIdentifiers: n } = this,
      r = t & 800;
    r & 768 || (r |= 768);
    const i = n.get(e);
    this.hasPrivateIdentifier(e) &&
      ((i & 32) !== (r & 32) || i & r & 768) &&
      this.parser.report(146, e),
      n.set(e, this.hasPrivateIdentifier(e) ? i | r : r);
  }
  addPrivateIdentifierRef(e) {
    (this.refs[e] ??= []), this.refs[e].push(this.parser.tokenStart);
  }
  isPrivateIdentifierDefined(e) {
    return (
      this.hasPrivateIdentifier(e) ||
      !!this.parent?.isPrivateIdentifierDefined(e)
    );
  }
  validatePrivateIdentifierRefs() {
    for (const e in this.refs)
      if (!this.isPrivateIdentifierDefined(e)) {
        const { index: t, line: n, column: r } = this.refs[e][0];
        throw new C$1(
          {
            index: t,
            line: n,
            column: r,
          },
          {
            index: t + e.length,
            line: n,
            column: r + e.length,
          },
          4,
          e,
        );
      }
  }
  hasPrivateIdentifier(e) {
    return this.privateIdentifiers.has(e);
  }
};
var dt = class {
  source;
  options;
  lastOnToken = null;
  token = 1048576;
  flags = 0;
  index = 0;
  line = 1;
  column = 0;
  startIndex = 0;
  end = 0;
  tokenIndex = 0;
  startColumn = 0;
  tokenColumn = 0;
  tokenLine = 1;
  startLine = 1;
  tokenValue = "";
  tokenRaw = "";
  tokenRegExp = void 0;
  currentChar = 0;
  exportedNames = /* @__PURE__ */ new Set();
  exportedBindings = /* @__PURE__ */ new Set();
  assignable = 1;
  destructible = 0;
  leadingDecorators = { decorators: [] };
  constructor(e, t = {}) {
    (this.source = e),
      (this.options = t),
      (this.end = e.length),
      (this.currentChar = e.charCodeAt(0));
  }
  getToken() {
    return this.token;
  }
  setToken(e, t = !1) {
    this.token = e;
    const { onToken: n } = this.options;
    if (n)
      if (e !== 1048576) {
        const r = {
          start: {
            line: this.tokenLine,
            column: this.tokenColumn,
          },
          end: {
            line: this.line,
            column: this.column,
          },
        };
        !t && this.lastOnToken && n(...this.lastOnToken),
          (this.lastOnToken = [me(e), this.tokenIndex, this.index, r]);
      } else this.lastOnToken &&= (n(...this.lastOnToken), null);
    return e;
  }
  get tokenStart() {
    return {
      index: this.tokenIndex,
      line: this.tokenLine,
      column: this.tokenColumn,
    };
  }
  get currentLocation() {
    return {
      index: this.index,
      line: this.line,
      column: this.column,
    };
  }
  finishNode(e, t, n) {
    if (this.options.ranges) {
      e.start = t.index;
      const r = n ? n.index : this.startIndex;
      (e.end = r), (e.range = [t.index, r]);
    }
    return (
      this.options.loc &&
        ((e.loc = {
          start: {
            line: t.line,
            column: t.column,
          },
          end: n
            ? {
                line: n.line,
                column: n.column,
              }
            : {
                line: this.startLine,
                column: this.startColumn,
              },
        }),
        this.options.source && (e.loc.source = this.options.source)),
      e
    );
  }
  addBindingToExports(e) {
    this.exportedBindings.add(e);
  }
  declareUnboundVariable(e) {
    const { exportedNames: t } = this;
    t.has(e) && this.report(147, e), t.add(e);
  }
  report(e, ...t) {
    throw new C$1(this.tokenStart, this.currentLocation, e, ...t);
  }
  createScopeIfLexical(e, t) {
    if (this.options.lexical) return this.createScope(e, t);
  }
  createScope(e, t) {
    return new ct(this, e, t);
  }
  createPrivateScopeIfLexical(e) {
    if (this.options.lexical) return new ut(this, e);
  }
};
function ft(e, t) {
  return (n, r, i, a, o) => {
    const s = {
      type: n,
      value: r,
    };
    t.ranges && ((s.start = i), (s.end = a), (s.range = [i, a])),
      t.loc && (s.loc = o),
      e.push(s);
  };
}
function pt(e, t) {
  return (n, r, i, a) => {
    const o = { token: n };
    t.ranges && ((o.start = r), (o.end = i), (o.range = [r, i])),
      t.loc && (o.loc = a),
      e.push(o);
  };
}
function mt(e) {
  const t = { ...e };
  return (
    (t.onComment &&= Array.isArray(t.onComment)
      ? ft(t.onComment, t)
      : t.onComment),
    (t.onToken &&= Array.isArray(t.onToken) ? pt(t.onToken, t) : t.onToken),
    t
  );
}
function ht(e, t = {}, n = 0) {
  const r = mt(t);
  r.module && (n |= 3),
    r.globalReturn && (n |= 4096),
    r.impliedStrict && (n |= 1);
  const i = new dt(e, r);
  be(i);
  let a = i.createScopeIfLexical(),
    o = [],
    s = "script";
  if (n & 2) {
    if (((s = "module"), (o = _t(i, n | 8, a)), a))
      for (const e of i.exportedBindings) a.hasVariable(e) || i.report(148, e);
  } else o = gt(i, n | 8, a);
  return i.finishNode(
    {
      type: "Program",
      sourceType: s,
      body: o,
    },
    {
      index: 0,
      line: 1,
      column: 0,
    },
    i.currentLocation,
  );
}
function gt(e, t, n) {
  A$1(e, t | 262176);
  const r = [];
  for (; e.getToken() === 134283267; ) {
    const { index: n, tokenValue: i, tokenStart: a, tokenIndex: o } = e,
      s = e.getToken(),
      c = q(e, t);
    if (Ie(e, n, o, i)) {
      if (((t |= 1), e.flags & 64))
        throw new C$1(e.tokenStart, e.currentLocation, 9);
      if (e.flags & 4096) throw new C$1(e.tokenStart, e.currentLocation, 15);
    }
    r.push(wt(e, t, c, s, a));
  }
  for (; e.getToken() !== 1048576; ) r.push(M$1(e, t, n, void 0, 4, {}));
  return r;
}
function _t(e, t, n) {
  A$1(e, t | 32);
  const r = [];
  for (; e.getToken() === 134283267; ) {
    const { tokenStart: n } = e,
      i = e.getToken();
    r.push(wt(e, t, q(e, t), i, n));
  }
  for (; e.getToken() !== 1048576; ) r.push(vt(e, t, n));
  return r;
}
function vt(e, t, n) {
  e.getToken() === 132 &&
    Object.assign(e.leadingDecorators, {
      start: e.tokenStart,
      decorators: Gn(e, t, void 0),
    });
  let r;
  switch (e.getToken()) {
    case 20564:
      r = Zt(e, t, n);
      break;
    case 86106:
      r = Gt(e, t, n);
      break;
    default:
      r = M$1(e, t, n, void 0, 4, {});
  }
  return e.leadingDecorators?.decorators.length && e.report(170), r;
}
function M$1(e, t, n, r, i, a) {
  const o = e.tokenStart;
  switch (e.getToken()) {
    case 86104:
      return J(e, t, n, r, i, 1, 0, 0, o);
    case 132:
    case 86094:
      return Un(e, t, n, r, 0);
    case 86090:
      return Bt(e, t, n, r, 16, 0);
    case 241737:
      return zt(e, t, n, r, i);
    case 20564:
      e.report(103, "export");
    case 86106:
      switch ((A$1(e, t), e.getToken())) {
        case 67174411:
          return Xt(e, t, r, o);
        case 67108877:
          return Yt(e, t, o);
        default:
          e.report(103, "import");
      }
    case 209005:
      return Ct(e, t, n, r, i, a, 1);
    default:
      return N$1(e, t, n, r, i, a, 1);
  }
}
function N$1(e, t, n, r, i, a, o) {
  switch (e.getToken()) {
    case 86088:
      return Vt(e, t, n, r, 0);
    case 20572:
      return xt(e, t, r);
    case 20569:
      return Dt(e, t, n, r, a);
    case 20567:
      return Ut(e, t, n, r, a);
    case 20562:
      return Rt(e, t, n, r, a);
    case 20578:
      return At(e, t, n, r, a);
    case 86110:
      return kt(e, t, n, r, a);
    case 1074790417:
      return Tt(e, t);
    case 2162700:
      return bt(e, t, n?.createChildScope(), r, a, e.tokenStart);
    case 86112:
      return Et(e, t, r);
    case 20555:
      return Mt(e, t, a);
    case 20559:
      return jt(e, t, a);
    case 20577:
      return Ft(e, t, n, r, a);
    case 20579:
      return Nt(e, t, n, r, a);
    case 20560:
      return Pt(e, t);
    case 209005:
      return Ct(e, t, n, r, i, a, 0);
    case 20557:
      e.report(162);
    case 20566:
      e.report(163);
    case 86104:
      e.report(t & 1 ? 76 : e.options.webcompat ? 77 : 78);
    case 86094:
      e.report(79);
    default:
      return yt$1(e, t, n, r, i, a, o);
  }
}
function yt$1(e, t, n, r, i, a, o) {
  let { tokenValue: s, tokenStart: c } = e,
    l = e.getToken(),
    u;
  switch (l) {
    case 241737:
      (u = K(e, t)),
        t & 1 && e.report(85),
        e.getToken() === 69271571 && e.report(84);
      break;
    default:
      u = G(e, t, r, 2, 0, 1, 0, 1, e.tokenStart);
  }
  return l & 143360 && e.getToken() === 21
    ? St(e, t, n, r, i, a, s, u, l, o, c)
    : ((u = W(e, t, r, u, 0, 0, c)),
      (u = B$1(e, t, r, 0, 0, c, u)),
      e.getToken() === 18 && (u = R$1(e, t, r, 0, c, u)),
      P$1(e, t, u, c));
}
function bt(e, t, n, r, i, a = e.tokenStart, o = "BlockStatement") {
  const s = [];
  for (D$1(e, t | 32, 2162700); e.getToken() !== 1074790415; )
    s.push(M$1(e, t, n, r, 2, { $: i }));
  return (
    D$1(e, t | 32, 1074790415),
    e.finishNode(
      {
        type: o,
        body: s,
      },
      a,
    )
  );
}
function xt(e, t, n) {
  t & 4096 || e.report(92);
  const r = e.tokenStart;
  A$1(e, t | 32);
  const i =
    e.flags & 1 || e.getToken() & 1048576
      ? null
      : z$1(e, t, n, 0, 1, e.tokenStart);
  return (
    T$1(e, t | 32),
    e.finishNode(
      {
        type: "ReturnStatement",
        argument: i,
      },
      r,
    )
  );
}
function P$1(e, t, n, r) {
  return (
    T$1(e, t | 32),
    e.finishNode(
      {
        type: "ExpressionStatement",
        expression: n,
      },
      r,
    )
  );
}
function St(e, t, n, r, i, a, o, s, c, l, u) {
  Re(e, t, 0, c, 1), Ue(e, a, o), A$1(e, t | 32);
  const d =
    l && !(t & 1) && e.options.webcompat && e.getToken() === 86104
      ? J(e, t, n?.createChildScope(), r, i, 0, 0, 0, e.tokenStart)
      : N$1(e, t, n, r, i, a, l);
  return e.finishNode(
    {
      type: "LabeledStatement",
      label: s,
      body: d,
    },
    u,
  );
}
function Ct(e, t, n, r, i, a, o) {
  let { tokenValue: s, tokenStart: c } = e,
    l = e.getToken(),
    u = K(e, t);
  if (e.getToken() === 21) return St(e, t, n, r, i, a, s, u, l, 1, c);
  const d = e.flags & 1;
  if (!d) {
    if (e.getToken() === 86104)
      return o || e.report(123), J(e, t, n, r, i, 1, 0, 1, c);
    if (k$1(t, e.getToken()))
      return (
        (u = Bn(e, t, r, 1, c)),
        e.getToken() === 18 && (u = R$1(e, t, r, 0, c, u)),
        P$1(e, t, u, c)
      );
  }
  return (
    e.getToken() === 67174411
      ? (u = Vn(e, t, r, u, 1, 1, 0, d, c))
      : (e.getToken() === 10 &&
          (Ge(e, t, l),
          (l & 36864) === 36864 && (e.flags |= 256),
          (u = Nn(e, t | 2048, r, e.tokenValue, u, 0, 1, 0, c))),
        (e.assignable = 1)),
    (u = W(e, t, r, u, 0, 0, c)),
    (u = B$1(e, t, r, 0, 0, c, u)),
    (e.assignable = 1),
    e.getToken() === 18 && (u = R$1(e, t, r, 0, c, u)),
    P$1(e, t, u, c)
  );
}
function wt(e, t, n, r, i) {
  const a = e.startIndex;
  r !== 1074790417 &&
    ((e.assignable = 2),
    (n = W(e, t, void 0, n, 0, 0, i)),
    e.getToken() !== 1074790417 &&
      ((n = B$1(e, t, void 0, 0, 0, i, n)),
      e.getToken() === 18 && (n = R$1(e, t, void 0, 0, i, n))),
    T$1(e, t | 32));
  const o = {
    type: "ExpressionStatement",
    expression: n,
  };
  return (
    n.type === "Literal" &&
      typeof n.value === "string" &&
      (o.directive = e.source.slice(i.index + 1, a - 1)),
    e.finishNode(o, i)
  );
}
function Tt(e, t) {
  const n = e.tokenStart;
  return A$1(e, t | 32), e.finishNode({ type: "EmptyStatement" }, n);
}
function Et(e, t, n) {
  const r = e.tokenStart;
  A$1(e, t | 32), e.flags & 1 && e.report(90);
  const i = z$1(e, t, n, 0, 1, e.tokenStart);
  return (
    T$1(e, t | 32),
    e.finishNode(
      {
        type: "ThrowStatement",
        argument: i,
      },
      r,
    )
  );
}
function Dt(e, t, n, r, i) {
  const a = e.tokenStart;
  A$1(e, t), D$1(e, t | 32, 67174411), (e.assignable = 1);
  const o = z$1(e, t, r, 0, 1, e.tokenStart);
  D$1(e, t | 32, 16);
  let s = Ot(e, t, n, r, i),
    c = null;
  return (
    e.getToken() === 20563 && (A$1(e, t | 32), (c = Ot(e, t, n, r, i))),
    e.finishNode(
      {
        type: "IfStatement",
        test: o,
        consequent: s,
        alternate: c,
      },
      a,
    )
  );
}
function Ot(e, t, n, r, i) {
  const { tokenStart: a } = e;
  return t & 1 || !e.options.webcompat || e.getToken() !== 86104
    ? N$1(e, t, n, r, 0, { $: i }, 0)
    : J(e, t, n?.createChildScope(), r, 0, 0, 0, 0, a);
}
function kt(e, t, n, r, i) {
  const a = e.tokenStart;
  A$1(e, t), D$1(e, t | 32, 67174411);
  const o = z$1(e, t, r, 0, 1, e.tokenStart);
  D$1(e, t, 16), D$1(e, t, 2162700);
  let s = [],
    c = 0;
  for (n = n?.createChildScope(8); e.getToken() !== 1074790415; ) {
    let { tokenStart: a } = e,
      o = null,
      l = [];
    for (
      E$1(e, t | 32, 20556)
        ? (o = z$1(e, t, r, 0, 1, e.tokenStart))
        : (D$1(e, t | 32, 20561), c && e.report(89), (c = 1)),
        D$1(e, t | 32, 21);
      e.getToken() !== 20556 &&
      e.getToken() !== 1074790415 &&
      e.getToken() !== 20561;
    )
      l.push(M$1(e, t | 4, n, r, 2, { $: i }));
    s.push(
      e.finishNode(
        {
          type: "SwitchCase",
          test: o,
          consequent: l,
        },
        a,
      ),
    );
  }
  return (
    D$1(e, t | 32, 1074790415),
    e.finishNode(
      {
        type: "SwitchStatement",
        discriminant: o,
        cases: s,
      },
      a,
    )
  );
}
function At(e, t, n, r, i) {
  const a = e.tokenStart;
  A$1(e, t), D$1(e, t | 32, 67174411);
  const o = z$1(e, t, r, 0, 1, e.tokenStart);
  D$1(e, t | 32, 16);
  const s = F(e, t, n, r, i);
  return e.finishNode(
    {
      type: "WhileStatement",
      test: o,
      body: s,
    },
    a,
  );
}
function F(e, t, n, r, i) {
  return N$1(
    e,
    ((t | 131072) ^ 131072) | 128,
    n,
    r,
    0,
    {
      loop: 1,
      $: i,
    },
    0,
  );
}
function jt(e, t, n) {
  t & 128 || e.report(68);
  const r = e.tokenStart;
  A$1(e, t);
  let i = null;
  if (!(e.flags & 1) && e.getToken() & 143360) {
    const { tokenValue: r } = e;
    (i = K(e, t | 32)), He(e, n, r, 1) || e.report(138, r);
  }
  return (
    T$1(e, t | 32),
    e.finishNode(
      {
        type: "ContinueStatement",
        label: i,
      },
      r,
    )
  );
}
function Mt(e, t, n) {
  const r = e.tokenStart;
  A$1(e, t | 32);
  let i = null;
  if (!(e.flags & 1) && e.getToken() & 143360) {
    const { tokenValue: r } = e;
    (i = K(e, t | 32)), He(e, n, r, 0) || e.report(138, r);
  } else t & 132 || e.report(69);
  return (
    T$1(e, t | 32),
    e.finishNode(
      {
        type: "BreakStatement",
        label: i,
      },
      r,
    )
  );
}
function Nt(e, t, n, r, i) {
  const a = e.tokenStart;
  A$1(e, t), t & 1 && e.report(91), D$1(e, t | 32, 67174411);
  const o = z$1(e, t, r, 0, 1, e.tokenStart);
  D$1(e, t | 32, 16);
  const s = N$1(e, t, n, r, 2, i, 0);
  return e.finishNode(
    {
      type: "WithStatement",
      object: o,
      body: s,
    },
    a,
  );
}
function Pt(e, t) {
  const n = e.tokenStart;
  return (
    A$1(e, t | 32),
    T$1(e, t | 32),
    e.finishNode({ type: "DebuggerStatement" }, n)
  );
}
function Ft(e, t, n, r, i) {
  const a = e.tokenStart;
  A$1(e, t | 32);
  let o = n?.createChildScope(16),
    s = bt(e, t, o, r, { $: i }),
    { tokenStart: c } = e,
    l = E$1(e, t | 32, 20557) ? It(e, t, n, r, i, c) : null,
    u = null;
  if (e.getToken() === 20566) {
    A$1(e, t | 32);
    const a = n?.createChildScope(4);
    u = bt(e, t, a, r, { $: i });
  }
  return (
    !l && !u && e.report(88),
    e.finishNode(
      {
        type: "TryStatement",
        block: s,
        handler: l,
        finalizer: u,
      },
      a,
    )
  );
}
function It(e, t, n, r, i, a) {
  let o = null,
    s = n;
  E$1(e, t, 67174411) &&
    ((n = n?.createChildScope(4)),
    (o = Zn(e, t, n, r, (e.getToken() & 2097152) === 2097152 ? 256 : 512, 0)),
    e.getToken() === 18
      ? e.report(86)
      : e.getToken() === 1077936155 && e.report(87),
    D$1(e, t | 32, 16)),
    (s = n?.createChildScope(32));
  const c = bt(e, t, s, r, { $: i });
  return e.finishNode(
    {
      type: "CatchClause",
      param: o,
      body: c,
    },
    a,
  );
}
function Lt(e, t, n, r, i) {
  n = n?.createChildScope();
  const a = 5764;
  return (t = ((t | a) ^ a) | 592128), bt(e, t, n, r, {}, i, "StaticBlock");
}
function Rt(e, t, n, r, i) {
  const a = e.tokenStart;
  A$1(e, t | 32);
  const o = F(e, t, n, r, i);
  D$1(e, t, 20578), D$1(e, t | 32, 67174411);
  const s = z$1(e, t, r, 0, 1, e.tokenStart);
  return (
    D$1(e, t | 32, 16),
    E$1(e, t | 32, 1074790417),
    e.finishNode(
      {
        type: "DoWhileStatement",
        body: o,
        test: s,
      },
      a,
    )
  );
}
function zt(e, t, n, r, i) {
  let { tokenValue: a, tokenStart: o } = e,
    s = e.getToken(),
    c = K(e, t);
  if (e.getToken() & 2240512) {
    const i = I$1(e, t, n, r, 8, 0);
    return (
      T$1(e, t | 32),
      e.finishNode(
        {
          type: "VariableDeclaration",
          kind: "let",
          declarations: i,
        },
        o,
      )
    );
  }
  if (((e.assignable = 1), t & 1 && e.report(85), e.getToken() === 21))
    return St(e, t, n, r, i, {}, a, c, s, 0, o);
  if (e.getToken() === 10) {
    let n;
    e.options.lexical && (n = lt(e, t, a)),
      (e.flags = (e.flags | 128) ^ 128),
      (c = Fn(e, t, n, r, [c], 0, o));
  } else (c = W(e, t, r, c, 0, 0, o)), (c = B$1(e, t, r, 0, 0, o, c));
  return e.getToken() === 18 && (c = R$1(e, t, r, 0, o, c)), P$1(e, t, c, o);
}
function Bt(e, t, n, r, i, a) {
  const o = e.tokenStart;
  A$1(e, t);
  const s = I$1(e, t, n, r, i, a);
  return (
    T$1(e, t | 32),
    e.finishNode(
      {
        type: "VariableDeclaration",
        kind: i & 8 ? "let" : "const",
        declarations: s,
      },
      o,
    )
  );
}
function Vt(e, t, n, r, i) {
  const a = e.tokenStart;
  A$1(e, t);
  const o = I$1(e, t, n, r, 4, i);
  return (
    T$1(e, t | 32),
    e.finishNode(
      {
        type: "VariableDeclaration",
        kind: "var",
        declarations: o,
      },
      a,
    )
  );
}
function I$1(e, t, n, r, i, a) {
  let o = 1,
    s = [Ht(e, t, n, r, i, a)];
  for (; E$1(e, t, 18); ) o++, s.push(Ht(e, t, n, r, i, a));
  return (
    o > 1 &&
      a & 32 &&
      e.getToken() & 262144 &&
      e.report(61, w$1[e.getToken() & 255]),
    s
  );
}
function Ht(e, t, n, r, i, a) {
  let { tokenStart: o } = e,
    s = e.getToken(),
    c = null,
    l = Zn(e, t, n, r, i, a);
  if (e.getToken() === 1077936155) {
    if (
      (A$1(e, t | 32),
      (c = L$1(e, t, r, 1, 0, e.tokenStart)),
      (a & 32 || !(s & 2097152)) &&
        (e.getToken() === 471156 ||
          (e.getToken() === 8673330 && (s & 2097152 || !(i & 4) || t & 1))))
    )
      throw new C$1(
        o,
        e.currentLocation,
        60,
        e.getToken() === 471156 ? "of" : "in",
      );
  } else
    (i & 16 || (s & 2097152) > 0) &&
      (e.getToken() & 262144) !== 262144 &&
      e.report(59, i & 16 ? "const" : "destructuring");
  return e.finishNode(
    {
      type: "VariableDeclarator",
      id: l,
      init: c,
    },
    o,
  );
}
function Ut(e, t, n, r, i) {
  const a = e.tokenStart;
  A$1(e, t);
  const o =
    ((t & 2048) > 0 || ((t & 2) > 0 && (t & 8) > 0)) && E$1(e, t, 209006);
  D$1(e, t | 32, 67174411), (n = n?.createChildScope(1));
  let s = null,
    c = null,
    l = 0,
    u = null,
    d =
      e.getToken() === 86088 ||
      e.getToken() === 241737 ||
      e.getToken() === 86090,
    f,
    { tokenStart: p } = e,
    m = e.getToken();
  if (d)
    m === 241737
      ? ((u = K(e, t)),
        e.getToken() & 2240512
          ? (e.getToken() === 8673330
              ? t & 1 && e.report(67)
              : (u = e.finishNode(
                  {
                    type: "VariableDeclaration",
                    kind: "let",
                    declarations: I$1(e, t | 131072, n, r, 8, 32),
                  },
                  p,
                )),
            (e.assignable = 1))
          : t & 1
            ? e.report(67)
            : ((d = !1),
              (e.assignable = 1),
              (u = W(e, t, r, u, 0, 0, p)),
              e.getToken() === 471156 && e.report(115)))
      : (A$1(e, t),
        (u = e.finishNode(
          m === 86088
            ? {
                type: "VariableDeclaration",
                kind: "var",
                declarations: I$1(e, t | 131072, n, r, 4, 32),
              }
            : {
                type: "VariableDeclaration",
                kind: "const",
                declarations: I$1(e, t | 131072, n, r, 16, 32),
              },
          p,
        )),
        (e.assignable = 1));
  else if (m === 1074790417) o && e.report(82);
  else if ((m & 2097152) === 2097152) {
    const n = e.tokenStart;
    (u =
      m === 2162700
        ? Q(e, t, void 0, r, 1, 0, 0, 2, 32)
        : Y(e, t, void 0, r, 1, 0, 0, 2, 32)),
      (l = e.destructible),
      l & 64 && e.report(63),
      (e.assignable = l & 16 ? 2 : 1),
      (u = W(e, t | 131072, r, u, 0, 0, n));
  } else u = U(e, t | 131072, r, 1, 0, 1);
  if ((e.getToken() & 262144) === 262144) {
    if (e.getToken() === 471156) {
      e.assignable & 2 && e.report(80, o ? "await" : "of"),
        O(e, u),
        A$1(e, t | 32),
        (f = L$1(e, t, r, 1, 0, e.tokenStart)),
        D$1(e, t | 32, 16);
      const s = F(e, t, n, r, i);
      return e.finishNode(
        {
          type: "ForOfStatement",
          left: u,
          right: f,
          body: s,
          await: o,
        },
        a,
      );
    }
    e.assignable & 2 && e.report(80, "in"),
      O(e, u),
      A$1(e, t | 32),
      o && e.report(82),
      (f = z$1(e, t, r, 0, 1, e.tokenStart)),
      D$1(e, t | 32, 16);
    const s = F(e, t, n, r, i);
    return e.finishNode(
      {
        type: "ForInStatement",
        body: s,
        left: u,
        right: f,
      },
      a,
    );
  }
  o && e.report(82),
    d ||
      (l & 8 && e.getToken() !== 1077936155 && e.report(80, "loop"),
      (u = B$1(e, t | 131072, r, 0, 0, p, u))),
    e.getToken() === 18 && (u = R$1(e, t, r, 0, p, u)),
    D$1(e, t | 32, 1074790417),
    e.getToken() !== 1074790417 && (s = z$1(e, t, r, 0, 1, e.tokenStart)),
    D$1(e, t | 32, 1074790417),
    e.getToken() !== 16 && (c = z$1(e, t, r, 0, 1, e.tokenStart)),
    D$1(e, t | 32, 16);
  const h = F(e, t, n, r, i);
  return e.finishNode(
    {
      type: "ForStatement",
      init: u,
      test: s,
      update: c,
      body: h,
    },
    a,
  );
}
function Wt(e, t, n) {
  return (
    k$1(t, e.getToken()) || e.report(118),
    (e.getToken() & 537079808) === 537079808 && e.report(119),
    n?.addBlockName(t, e.tokenValue, 8, 0),
    K(e, t)
  );
}
function Gt(e, t, n) {
  const r = e.tokenStart;
  A$1(e, t);
  let i = null,
    { tokenStart: a } = e,
    o = [];
  if (e.getToken() === 134283267) i = q(e, t);
  else {
    if (e.getToken() & 143360) {
      const r = Wt(e, t, n);
      if (
        ((o = [
          e.finishNode(
            {
              type: "ImportDefaultSpecifier",
              local: r,
            },
            a,
          ),
        ]),
        E$1(e, t, 18))
      )
        switch (e.getToken()) {
          case 8391476:
            o.push(Kt(e, t, n));
            break;
          case 2162700:
            Jt(e, t, n, o);
            break;
          default:
            e.report(107);
        }
    } else
      switch (e.getToken()) {
        case 8391476:
          o = [Kt(e, t, n)];
          break;
        case 2162700:
          Jt(e, t, n, o);
          break;
        case 67174411:
          return Xt(e, t, void 0, r);
        case 67108877:
          return Yt(e, t, r);
        default:
          e.report(30, w$1[e.getToken() & 255]);
      }
    i = qt(e, t);
  }
  const s = pn(e, t),
    c = {
      type: "ImportDeclaration",
      specifiers: o,
      source: i,
      attributes: s,
    };
  return T$1(e, t | 32), e.finishNode(c, r);
}
function Kt(e, t, n) {
  const { tokenStart: r } = e;
  if ((A$1(e, t), D$1(e, t, 77932), (e.getToken() & 134217728) === 134217728))
    throw new C$1(r, e.currentLocation, 30, w$1[e.getToken() & 255]);
  return e.finishNode(
    {
      type: "ImportNamespaceSpecifier",
      local: Wt(e, t, n),
    },
    r,
  );
}
function qt(e, t) {
  return (
    D$1(e, t, 209011),
    e.getToken() !== 134283267 && e.report(105, "Import"),
    q(e, t)
  );
}
function Jt(e, t, n, r) {
  for (A$1(e, t); e.getToken() & 143360 || e.getToken() === 134283267; ) {
    let { tokenValue: i, tokenStart: a } = e,
      o = e.getToken(),
      s = _n(e, t),
      c;
    E$1(e, t, 77932)
      ? ((e.getToken() & 134217728) === 134217728 || e.getToken() === 18
          ? e.report(106)
          : Re(e, t, 16, e.getToken(), 0),
        (i = e.tokenValue),
        (c = K(e, t)))
      : s.type === "Identifier"
        ? (Re(e, t, 16, o, 0), (c = s))
        : e.report(25, w$1[108]),
      n?.addBlockName(t, i, 8, 0),
      r.push(
        e.finishNode(
          {
            type: "ImportSpecifier",
            local: c,
            imported: s,
          },
          a,
        ),
      ),
      e.getToken() !== 1074790415 && D$1(e, t, 18);
  }
  return D$1(e, t, 1074790415), r;
}
function Yt(e, t, n) {
  let r = dn(
    e,
    t,
    e.finishNode(
      {
        type: "Identifier",
        name: "import",
      },
      n,
    ),
    n,
  );
  return (
    (r = W(e, t, void 0, r, 0, 0, n)),
    (r = B$1(e, t, void 0, 0, 0, n, r)),
    e.getToken() === 18 && (r = R$1(e, t, void 0, 0, n, r)),
    P$1(e, t, r, n)
  );
}
function Xt(e, t, n, r) {
  let i = fn(e, t, n, 0, r);
  return (
    (i = W(e, t, n, i, 0, 0, r)),
    e.getToken() === 18 && (i = R$1(e, t, n, 0, r, i)),
    P$1(e, t, i, r)
  );
}
function Zt(e, t, n) {
  const r = e.leadingDecorators.decorators.length
    ? e.leadingDecorators.start
    : e.tokenStart;
  A$1(e, t | 32);
  let i = [],
    a = null,
    o = null,
    s = [];
  if (E$1(e, t | 32, 20561)) {
    switch (e.getToken()) {
      case 86104:
        a = J(e, t, n, void 0, 4, 1, 1, 0, e.tokenStart);
        break;
      case 132:
      case 86094:
        a = Un(e, t, n, void 0, 1);
        break;
      case 209005: {
        const { tokenStart: r } = e;
        a = K(e, t);
        const { flags: i } = e;
        i & 1 ||
          (e.getToken() === 86104
            ? (a = J(e, t, n, void 0, 4, 1, 1, 1, r))
            : e.getToken() === 67174411
              ? ((a = Vn(e, t, void 0, a, 1, 1, 0, i, r)),
                (a = W(e, t, void 0, a, 0, 0, r)),
                (a = B$1(e, t, void 0, 0, 0, r, a)))
              : e.getToken() & 143360 &&
                ((n &&= lt(e, t, e.tokenValue)),
                (a = K(e, t)),
                (a = Fn(e, t, n, void 0, [a], 1, r))));
        break;
      }
      default:
        (a = L$1(e, t, void 0, 1, 0, e.tokenStart)), T$1(e, t | 32);
    }
    return (
      n && e.declareUnboundVariable("default"),
      e.finishNode(
        {
          type: "ExportDefaultDeclaration",
          declaration: a,
        },
        r,
      )
    );
  }
  switch (e.getToken()) {
    case 8391476: {
      A$1(e, t);
      let i = null;
      E$1(e, t, 77932) &&
        (n && e.declareUnboundVariable(e.tokenValue), (i = _n(e, t))),
        D$1(e, t, 209011),
        e.getToken() !== 134283267 && e.report(105, "Export"),
        (o = q(e, t));
      const a = pn(e, t),
        s = {
          type: "ExportAllDeclaration",
          source: o,
          exported: i,
          attributes: a,
        };
      return T$1(e, t | 32), e.finishNode(s, r);
    }
    case 2162700: {
      A$1(e, t);
      let r = [],
        a = [],
        c = 0;
      for (; e.getToken() & 143360 || e.getToken() === 134283267; ) {
        const { tokenStart: o, tokenValue: s } = e,
          l = _n(e, t);
        l.type === "Literal" && (c = 1);
        let u;
        e.getToken() === 77932
          ? (A$1(e, t),
            !(e.getToken() & 143360) &&
              e.getToken() !== 134283267 &&
              e.report(106),
            n && (r.push(e.tokenValue), a.push(s)),
            (u = _n(e, t)))
          : (n && (r.push(e.tokenValue), a.push(e.tokenValue)), (u = l)),
          i.push(
            e.finishNode(
              {
                type: "ExportSpecifier",
                local: l,
                exported: u,
              },
              o,
            ),
          ),
          e.getToken() !== 1074790415 && D$1(e, t, 18);
      }
      D$1(e, t, 1074790415),
        E$1(e, t, 209011)
          ? (e.getToken() !== 134283267 && e.report(105, "Export"),
            (o = q(e, t)),
            (s = pn(e, t)),
            n && r.forEach((t) => e.declareUnboundVariable(t)))
          : (c && e.report(172),
            n &&
              (r.forEach((t) => e.declareUnboundVariable(t)),
              a.forEach((t) => e.addBindingToExports(t)))),
        T$1(e, t | 32);
      break;
    }
    case 132:
    case 86094:
      a = Un(e, t, n, void 0, 2);
      break;
    case 86104:
      a = J(e, t, n, void 0, 4, 1, 2, 0, e.tokenStart);
      break;
    case 241737:
      a = Bt(e, t, n, void 0, 8, 64);
      break;
    case 86090:
      a = Bt(e, t, n, void 0, 16, 64);
      break;
    case 86088:
      a = Vt(e, t, n, void 0, 64);
      break;
    case 209005: {
      const { tokenStart: r } = e;
      if ((A$1(e, t), !(e.flags & 1) && e.getToken() === 86104)) {
        a = J(e, t, n, void 0, 4, 1, 2, 1, r);
        break;
      }
    }
    default:
      e.report(30, w$1[e.getToken() & 255]);
  }
  const c = {
    type: "ExportNamedDeclaration",
    declaration: a,
    specifiers: i,
    source: o,
    attributes: s,
  };
  return e.finishNode(c, r);
}
function L$1(e, t, n, r, i, a) {
  let o = G(e, t, n, 2, 0, r, i, 1, a);
  return (o = W(e, t, n, o, i, 0, a)), B$1(e, t, n, i, 0, a, o);
}
function R$1(e, t, n, r, i, a) {
  const o = [a];
  for (; E$1(e, t | 32, 18); ) o.push(L$1(e, t, n, 1, r, e.tokenStart));
  return e.finishNode(
    {
      type: "SequenceExpression",
      expressions: o,
    },
    i,
  );
}
function z$1(e, t, n, r, i, a) {
  const o = L$1(e, t, n, i, r, a);
  return e.getToken() === 18 ? R$1(e, t, n, r, a, o) : o;
}
function B$1(e, t, n, r, i, a, o) {
  const s = e.getToken();
  if ((s & 4194304) === 4194304) {
    e.assignable & 2 && e.report(26),
      ((!i && s === 1077936155 && o.type === "ArrayExpression") ||
        o.type === "ObjectExpression") &&
        O(e, o),
      A$1(e, t | 32);
    const c = L$1(e, t, n, 1, r, e.tokenStart);
    return (
      (e.assignable = 2),
      e.finishNode(
        i
          ? {
              type: "AssignmentPattern",
              left: o,
              right: c,
            }
          : {
              type: "AssignmentExpression",
              left: o,
              operator: w$1[s & 255],
              right: c,
            },
        a,
      )
    );
  }
  return (
    (s & 8388608) === 8388608 && (o = H$1(e, t, n, r, a, 4, s, o)),
    E$1(e, t | 32, 22) && (o = V$1(e, t, n, o, a)),
    o
  );
}
function Qt(e, t, n, r, i, a, o) {
  const s = e.getToken();
  A$1(e, t | 32);
  const c = L$1(e, t, n, 1, r, e.tokenStart);
  return (
    (o = e.finishNode(
      i
        ? {
            type: "AssignmentPattern",
            left: o,
            right: c,
          }
        : {
            type: "AssignmentExpression",
            left: o,
            operator: w$1[s & 255],
            right: c,
          },
      a,
    )),
    (e.assignable = 2),
    o
  );
}
function V$1(e, t, n, r, i) {
  const a = L$1(e, (t | 131072) ^ 131072, n, 1, 0, e.tokenStart);
  D$1(e, t | 32, 21), (e.assignable = 1);
  const o = L$1(e, t, n, 1, 0, e.tokenStart);
  return (
    (e.assignable = 2),
    e.finishNode(
      {
        type: "ConditionalExpression",
        test: r,
        consequent: a,
        alternate: o,
      },
      i,
    )
  );
}
function H$1(e, t, n, r, i, a, o, s) {
  let c = -((t & 131072) > 0) & 8673330,
    l,
    u;
  for (
    e.assignable = 2;
    e.getToken() & 8388608 &&
    ((l = e.getToken()),
    (u = l & 3840),
    ((l & 524288 && o & 268435456) || (o & 524288 && l & 268435456)) &&
      e.report(165),
    !(u + ((l === 8391735) << 8) - ((c === l) << 12) <= a));
  )
    A$1(e, t | 32),
      (s = e.finishNode(
        {
          type:
            l & 524288 || l & 268435456
              ? "LogicalExpression"
              : "BinaryExpression",
          left: s,
          right: H$1(e, t, n, r, e.tokenStart, u, l, U(e, t, n, 0, r, 1)),
          operator: w$1[l & 255],
        },
        i,
      ));
  return e.getToken() === 1077936155 && e.report(26), s;
}
function $t(e, t, n, r, i) {
  r || e.report(0);
  const { tokenStart: a } = e,
    o = e.getToken();
  A$1(e, t | 32);
  const s = U(e, t, n, 0, i, 1);
  return (
    e.getToken() === 8391735 && e.report(33),
    t & 1 &&
      o === 16863276 &&
      (s.type === "Identifier" ? e.report(121) : Ve(s) && e.report(127)),
    (e.assignable = 2),
    e.finishNode(
      {
        type: "UnaryExpression",
        operator: w$1[o & 255],
        argument: s,
        prefix: !0,
      },
      a,
    )
  );
}
function en(e, t, n, r, i, a, o, s) {
  const c = e.getToken(),
    l = K(e, t),
    { flags: u } = e;
  if (!(u & 1)) {
    if (e.getToken() === 86104) return En(e, t, n, 1, r, s);
    if (k$1(t, e.getToken()))
      return (
        i || e.report(0),
        (e.getToken() & 36864) === 36864 && (e.flags |= 256),
        Bn(e, t, n, a, s)
      );
  }
  return !o && e.getToken() === 67174411
    ? Vn(e, t, n, l, a, 1, 0, u, s)
    : e.getToken() === 10
      ? (Ge(e, t, c),
        o && e.report(51),
        (c & 36864) === 36864 && (e.flags |= 256),
        Nn(e, t, n, e.tokenValue, l, o, a, 0, s))
      : ((e.assignable = 1), l);
}
function tn(e, t, n, r, i, a) {
  if ((r && (e.destructible |= 256), t & 1024)) {
    A$1(e, t | 32),
      t & 8192 && e.report(32),
      i || e.report(26),
      e.getToken() === 22 && e.report(124);
    let r = null,
      o = !1;
    return (
      e.flags & 1
        ? e.getToken() === 8391476 && e.report(30, w$1[e.getToken() & 255])
        : ((o = E$1(e, t | 32, 8391476)),
          (e.getToken() & 77824 || o) &&
            (r = L$1(e, t, n, 1, 0, e.tokenStart))),
      (e.assignable = 2),
      e.finishNode(
        {
          type: "YieldExpression",
          argument: r,
          delegate: o,
        },
        a,
      )
    );
  }
  return t & 1 && e.report(97, "yield"), Mn(e, t, n);
}
function nn(e, t, n, r, i, a) {
  i && (e.destructible |= 128), t & 524288 && e.report(177);
  const o = Mn(e, t, n);
  if (o.type === "ArrowFunctionExpression" || !(e.getToken() & 65536)) {
    if (t & 2048)
      throw new C$1(
        a,
        {
          index: e.startIndex,
          line: e.startLine,
          column: e.startColumn,
        },
        176,
      );
    if (t & 2 || (t & 8192 && t & 2048))
      throw new C$1(
        a,
        {
          index: e.startIndex,
          line: e.startLine,
          column: e.startColumn,
        },
        110,
      );
    return o;
  }
  if (t & 8192)
    throw new C$1(
      a,
      {
        index: e.startIndex,
        line: e.startLine,
        column: e.startColumn,
      },
      31,
    );
  if (t & 2048 || (t & 2 && t & 8)) {
    if (r)
      throw new C$1(
        a,
        {
          index: e.startIndex,
          line: e.startLine,
          column: e.startColumn,
        },
        0,
      );
    const i = U(e, t, n, 0, 0, 1);
    return (
      e.getToken() === 8391735 && e.report(33),
      (e.assignable = 2),
      e.finishNode(
        {
          type: "AwaitExpression",
          argument: i,
        },
        a,
      )
    );
  }
  if (t & 2)
    throw new C$1(
      a,
      {
        index: e.startIndex,
        line: e.startLine,
        column: e.startColumn,
      },
      98,
    );
  return o;
}
function rn(e, t, n, r, i, a, o) {
  const { tokenStart: s } = e;
  D$1(e, t | 32, 2162700);
  const c = [];
  if (e.getToken() !== 1074790415) {
    for (; e.getToken() === 134283267; ) {
      const { index: n, tokenStart: r, tokenIndex: i, tokenValue: a } = e,
        s = e.getToken(),
        l = q(e, t);
      if (Ie(e, n, i, a)) {
        if (((t |= 1), e.flags & 128)) throw new C$1(r, e.currentLocation, 66);
        if (e.flags & 64) throw new C$1(r, e.currentLocation, 9);
        if (e.flags & 4096) throw new C$1(r, e.currentLocation, 15);
        o?.reportScopeError();
      }
      c.push(wt(e, t, l, s, r));
    }
    t & 1 &&
      (a &&
        ((a & 537079808) === 537079808 && e.report(119),
        (a & 36864) === 36864 && e.report(40)),
      e.flags & 512 && e.report(119),
      e.flags & 256 && e.report(118));
  }
  for (
    e.flags = (e.flags | 4928) ^ 4928,
      e.destructible = (e.destructible | 256) ^ 256;
    e.getToken() !== 1074790415;
  )
    c.push(M$1(e, t, n, r, 4, {}));
  return (
    D$1(e, i & 24 ? t | 32 : t, 1074790415),
    (e.flags &= -4289),
    e.getToken() === 1077936155 && e.report(26),
    e.finishNode(
      {
        type: "BlockStatement",
        body: c,
      },
      s,
    )
  );
}
function an(e, t) {
  const { tokenStart: n } = e;
  switch ((A$1(e, t), e.getToken())) {
    case 67108990:
      e.report(167);
    case 67174411:
      t & 512 || e.report(28), (e.assignable = 2);
      break;
    case 69271571:
    case 67108877:
      t & 256 || e.report(29), (e.assignable = 1);
      break;
    default:
      e.report(30, "super");
  }
  return e.finishNode({ type: "Super" }, n);
}
function U(e, t, n, r, i, a) {
  const o = e.tokenStart;
  return W(e, t, n, G(e, t, n, 2, 0, r, i, a, o), i, 0, o);
}
function on(e, t, n, r) {
  e.assignable & 2 && e.report(55);
  const i = e.getToken();
  return (
    A$1(e, t),
    (e.assignable = 2),
    e.finishNode(
      {
        type: "UpdateExpression",
        argument: n,
        operator: w$1[i & 255],
        prefix: !1,
      },
      r,
    )
  );
}
function W(e, t, n, r, i, a, o) {
  if ((e.getToken() & 33619968) === 33619968 && !(e.flags & 1))
    r = on(e, t, r, o);
  else if ((e.getToken() & 67108864) === 67108864) {
    switch (((t = (t | 131072) ^ 131072), e.getToken())) {
      case 67108877: {
        A$1(e, (t | 262152) ^ 8),
          t & 16 &&
            e.getToken() === 130 &&
            e.tokenValue === "super" &&
            e.report(173),
          (e.assignable = 1);
        const i = cn(e, t | 64, n);
        r = e.finishNode(
          {
            type: "MemberExpression",
            object: r,
            computed: !1,
            property: i,
            optional: !1,
          },
          o,
        );
        break;
      }
      case 69271571: {
        let a = !1;
        (e.flags & 2048) === 2048 &&
          ((a = !0), (e.flags = (e.flags | 2048) ^ 2048)),
          A$1(e, t | 32);
        const { tokenStart: s } = e,
          c = z$1(e, t, n, i, 1, s);
        D$1(e, t, 20),
          (e.assignable = 1),
          (r = e.finishNode(
            {
              type: "MemberExpression",
              object: r,
              computed: !0,
              property: c,
              optional: !1,
            },
            o,
          )),
          a && (e.flags |= 2048);
        break;
      }
      case 67174411: {
        if ((e.flags & 1024) === 1024)
          return (e.flags = (e.flags | 1024) ^ 1024), r;
        let a = !1;
        (e.flags & 2048) === 2048 &&
          ((a = !0), (e.flags = (e.flags | 2048) ^ 2048));
        const s = Cn(e, t, n, i);
        (e.assignable = 2),
          (r = e.finishNode(
            {
              type: "CallExpression",
              callee: r,
              arguments: s,
              optional: !1,
            },
            o,
          )),
          a && (e.flags |= 2048);
        break;
      }
      case 67108990:
        A$1(e, (t | 262152) ^ 8),
          (e.flags |= 2048),
          (e.assignable = 2),
          (r = sn(e, t, n, r, o));
        break;
      default:
        (e.flags & 2048) === 2048 && e.report(166),
          (e.assignable = 2),
          (r = e.finishNode(
            {
              type: "TaggedTemplateExpression",
              tag: r,
              quasi: e.getToken() === 67174408 ? bn(e, t | 64, n) : yn(e, t),
            },
            o,
          ));
    }
    r = W(e, t, n, r, 0, 1, o);
  }
  return (
    a === 0 &&
      (e.flags & 2048) === 2048 &&
      ((e.flags = (e.flags | 2048) ^ 2048),
      (r = e.finishNode(
        {
          type: "ChainExpression",
          expression: r,
        },
        o,
      ))),
    r
  );
}
function sn(e, t, n, r, i) {
  let a = !1,
    o;
  if (
    ((e.getToken() === 69271571 || e.getToken() === 67174411) &&
      (e.flags & 2048) === 2048 &&
      ((a = !0), (e.flags = (e.flags | 2048) ^ 2048)),
    e.getToken() === 69271571)
  ) {
    A$1(e, t | 32);
    const { tokenStart: a } = e,
      s = z$1(e, t, n, 0, 1, a);
    D$1(e, t, 20),
      (e.assignable = 2),
      (o = e.finishNode(
        {
          type: "MemberExpression",
          object: r,
          computed: !0,
          optional: !0,
          property: s,
        },
        i,
      ));
  } else if (e.getToken() === 67174411) {
    const a = Cn(e, t, n, 0);
    (e.assignable = 2),
      (o = e.finishNode(
        {
          type: "CallExpression",
          callee: r,
          arguments: a,
          optional: !0,
        },
        i,
      ));
  } else {
    const a = cn(e, t, n);
    (e.assignable = 2),
      (o = e.finishNode(
        {
          type: "MemberExpression",
          object: r,
          computed: !1,
          optional: !0,
          property: a,
        },
        i,
      ));
  }
  return a && (e.flags |= 2048), o;
}
function cn(e, t, n) {
  return (
    !(e.getToken() & 143360) &&
      e.getToken() !== -2147483528 &&
      e.getToken() !== -2147483527 &&
      e.getToken() !== 130 &&
      e.report(160),
    e.getToken() === 130 ? Yn(e, t, n, 0) : K(e, t)
  );
}
function ln(e, t, n, r, i, a) {
  r && e.report(56), i || e.report(0);
  const o = e.getToken();
  A$1(e, t | 32);
  const s = U(e, t, n, 0, 0, 1);
  return (
    e.assignable & 2 && e.report(55),
    (e.assignable = 2),
    e.finishNode(
      {
        type: "UpdateExpression",
        argument: s,
        operator: w$1[o & 255],
        prefix: !0,
      },
      a,
    )
  );
}
function G(e, t, n, r, i, a, o, s, c) {
  if ((e.getToken() & 143360) === 143360) {
    switch (e.getToken()) {
      case 209006:
        return nn(e, t, n, i, o, c);
      case 241771:
        return tn(e, t, n, o, a, c);
      case 209005:
        return en(e, t, n, o, s, a, i, c);
    }
    const { tokenValue: l } = e,
      u = e.getToken(),
      d = K(e, t | 64);
    return e.getToken() === 10
      ? (s || e.report(0),
        Ge(e, t, u),
        (u & 36864) === 36864 && (e.flags |= 256),
        Nn(e, t, n, l, d, i, a, 0, c))
      : (t & 16 &&
          !(t & 32768) &&
          !(t & 8192) &&
          e.tokenValue === "arguments" &&
          e.report(130),
        (u & 255) === 73 && (t & 1 && e.report(113), r & 24 && e.report(100)),
        (e.assignable = t & 1 && (u & 537079808) === 537079808 ? 2 : 1),
        d);
  }
  if ((e.getToken() & 134217728) === 134217728) return q(e, t);
  switch (e.getToken()) {
    case 33619993:
    case 33619994:
      return ln(e, t, n, i, s, c);
    case 16863276:
    case 16842798:
    case 16842799:
    case 25233968:
    case 25233969:
    case 16863275:
    case 16863277:
      return $t(e, t, n, s, o);
    case 86104:
      return En(e, t, n, 0, o, c);
    case 2162700:
      return kn(e, t, n, +!a, o);
    case 69271571:
      return Dn(e, t, n, +!a, o);
    case 67174411:
      return jn(e, t | 64, n, a, 1, 0, c);
    case 86021:
    case 86022:
    case 86023:
      return wn(e, t);
    case 86111:
      return Tn(e, t);
    case 65540:
      return Hn(e, t);
    case 132:
    case 86094:
      return Wn(e, t, n, o, c);
    case 86109:
      return an(e, t);
    case 67174409:
      return yn(e, t);
    case 67174408:
      return bn(e, t, n);
    case 86107:
      return Rn(e, t, n, o);
    case 134283388:
      return vn(e, t);
    case 130:
      return Yn(e, t, n, 0);
    case 86106:
      return un(e, t, n, i, o, c);
    case 8456256:
      if (e.options.jsx) return $n(e, t, n, 0, e.tokenStart);
    default:
      if (k$1(t, e.getToken())) return Mn(e, t, n);
      e.report(30, w$1[e.getToken() & 255]);
  }
}
function un(e, t, n, r, i, a) {
  let o = K(e, t);
  return e.getToken() === 67108877
    ? dn(e, t, o, a)
    : (r && e.report(142),
      (o = fn(e, t, n, i, a)),
      (e.assignable = 2),
      W(e, t, n, o, i, 0, a));
}
function dn(e, t, n, r) {
  t & 2 || e.report(169), A$1(e, t);
  const i = e.getToken();
  return (
    i !== 209030 && e.tokenValue !== "meta"
      ? e.report(174)
      : i & -2147483648 && e.report(175),
    (e.assignable = 2),
    e.finishNode(
      {
        type: "MetaProperty",
        meta: n,
        property: K(e, t),
      },
      r,
    )
  );
}
function fn(e, t, n, r, i) {
  D$1(e, t | 32, 67174411), e.getToken() === 14 && e.report(143);
  let a = L$1(e, t, n, 1, r, e.tokenStart),
    o = null;
  e.getToken() === 18 &&
    (D$1(e, t, 18),
    e.getToken() !== 16 &&
      (o = L$1(e, (t | 131072) ^ 131072, n, 1, r, e.tokenStart)),
    E$1(e, t, 18));
  const s = {
    type: "ImportExpression",
    source: a,
    options: o,
  };
  return D$1(e, t, 16), e.finishNode(s, i);
}
function pn(e, t) {
  if (!E$1(e, t, 20579)) return [];
  D$1(e, t, 2162700);
  const n = [],
    r = /* @__PURE__ */ new Set();
  for (; e.getToken() !== 1074790415; ) {
    const i = e.tokenStart,
      a = hn(e, t);
    D$1(e, t, 21);
    const o = mn(e, t),
      s = a.type === "Literal" ? a.value : a.name;
    r.has(s) && e.report(145, `${s}`),
      r.add(s),
      n.push(
        e.finishNode(
          {
            type: "ImportAttribute",
            key: a,
            value: o,
          },
          i,
        ),
      ),
      e.getToken() !== 1074790415 && D$1(e, t, 18);
  }
  return D$1(e, t, 1074790415), n;
}
function mn(e, t) {
  if (e.getToken() === 134283267) return q(e, t);
  e.report(30, w$1[e.getToken() & 255]);
}
function hn(e, t) {
  if (e.getToken() === 134283267) return q(e, t);
  if (e.getToken() & 143360) return K(e, t);
  e.report(30, w$1[e.getToken() & 255]);
}
function gn(e, t) {
  const n = t.length;
  for (let r = 0; r < n; r++) {
    const i = t.charCodeAt(r);
    (i & 64512) === 55296 &&
      (i > 56319 || ++r >= n || (t.charCodeAt(r) & 64512) !== 56320) &&
      e.report(171, JSON.stringify(t.charAt(r--)));
  }
}
function _n(e, t) {
  if (e.getToken() === 134283267) return gn(e, e.tokenValue), q(e, t);
  if (e.getToken() & 143360) return K(e, t);
  e.report(30, w$1[e.getToken() & 255]);
}
function vn(e, t) {
  const { tokenRaw: n, tokenValue: r, tokenStart: i } = e;
  A$1(e, t), (e.assignable = 2);
  const a = {
    type: "Literal",
    value: r,
    bigint: String(r),
  };
  return e.options.raw && (a.raw = n), e.finishNode(a, i);
}
function yn(e, t) {
  e.assignable = 2;
  const { tokenValue: n, tokenRaw: r, tokenStart: i } = e;
  D$1(e, t, 67174409);
  const a = [xn(e, n, r, i, !0)];
  return e.finishNode(
    {
      type: "TemplateLiteral",
      expressions: [],
      quasis: a,
    },
    i,
  );
}
function bn(e, t, n) {
  t = (t | 131072) ^ 131072;
  const { tokenValue: r, tokenRaw: i, tokenStart: a } = e;
  D$1(e, (t & -65) | 32, 67174408);
  const o = [xn(e, r, i, a, !1)],
    s = [z$1(e, t & -65, n, 0, 1, e.tokenStart)];
  for (
    e.getToken() !== 1074790415 && e.report(83);
    e.setToken(je(e, t), !0) !== 67174409;
  ) {
    const { tokenValue: r, tokenRaw: i, tokenStart: a } = e;
    D$1(e, (t & -65) | 32, 67174408),
      o.push(xn(e, r, i, a, !1)),
      s.push(z$1(e, t, n, 0, 1, e.tokenStart)),
      e.getToken() !== 1074790415 && e.report(83);
  }
  {
    const { tokenValue: n, tokenRaw: r, tokenStart: i } = e;
    D$1(e, t, 67174409), o.push(xn(e, n, r, i, !0));
  }
  return e.finishNode(
    {
      type: "TemplateLiteral",
      expressions: s,
      quasis: o,
    },
    a,
  );
}
function xn(e, t, n, r, i) {
  const a = e.finishNode(
      {
        type: "TemplateElement",
        value: {
          cooked: t,
          raw: n,
        },
        tail: i,
      },
      r,
    ),
    o = i ? 1 : 2;
  return (
    e.options.ranges &&
      ((a.start += 1), (a.range[0] += 1), (a.end -= o), (a.range[1] -= o)),
    e.options.loc && ((a.loc.start.column += 1), (a.loc.end.column -= o)),
    a
  );
}
function Sn(e, t, n) {
  const r = e.tokenStart;
  (t = (t | 131072) ^ 131072), D$1(e, t | 32, 14);
  const i = L$1(e, t, n, 1, 0, e.tokenStart);
  return (
    (e.assignable = 1),
    e.finishNode(
      {
        type: "SpreadElement",
        argument: i,
      },
      r,
    )
  );
}
function Cn(e, t, n, r) {
  A$1(e, t | 32);
  const i = [];
  if (e.getToken() === 16) return A$1(e, t | 64), i;
  for (
    ;
    e.getToken() !== 16 &&
    (e.getToken() === 14
      ? i.push(Sn(e, t, n))
      : i.push(L$1(e, t, n, 1, r, e.tokenStart)),
    !(e.getToken() !== 18 || (A$1(e, t | 32), e.getToken() === 16)));
  );
  return D$1(e, t | 64, 16), i;
}
function K(e, t) {
  const { tokenValue: n, tokenStart: r } = e;
  return (
    A$1(e, t | (n === "await" && !(e.getToken() & -2147483648) ? 32 : 0)),
    e.finishNode(
      {
        type: "Identifier",
        name: n,
      },
      r,
    )
  );
}
function q(e, t) {
  const { tokenValue: n, tokenRaw: r, tokenStart: i } = e;
  return e.getToken() === 134283388
    ? vn(e, t)
    : (A$1(e, t),
      (e.assignable = 2),
      e.finishNode(
        e.options.raw
          ? {
              type: "Literal",
              value: n,
              raw: r,
            }
          : {
              type: "Literal",
              value: n,
            },
        i,
      ));
}
function wn(e, t) {
  const n = e.tokenStart,
    r = w$1[e.getToken() & 255],
    i = e.getToken() === 86023 ? null : r === "true";
  return (
    A$1(e, t),
    (e.assignable = 2),
    e.finishNode(
      e.options.raw
        ? {
            type: "Literal",
            value: i,
            raw: r,
          }
        : {
            type: "Literal",
            value: i,
          },
      n,
    )
  );
}
function Tn(e, t) {
  const { tokenStart: n } = e;
  return (
    A$1(e, t), (e.assignable = 2), e.finishNode({ type: "ThisExpression" }, n)
  );
}
function J(e, t, n, r, i, a, o, s, c) {
  A$1(e, t | 32);
  let l = a ? Le(e, t, 8391476) : 0,
    u = null,
    d,
    f = n ? e.createScope() : void 0;
  if (e.getToken() === 67174411) o & 1 || e.report(39, "Function");
  else {
    const r =
      i & 4 && (!(t & 8) || !(t & 2))
        ? 4
        : 64 | (s ? 1024 : 0) | (l ? 1024 : 0);
    ze(e, t, e.getToken()),
      n &&
        (r & 4
          ? n.addVarName(t, e.tokenValue, r)
          : n.addBlockName(t, e.tokenValue, r, i),
        (f = f?.createChildScope(128)),
        o && o & 2 && e.declareUnboundVariable(e.tokenValue)),
      (d = e.getToken()),
      e.getToken() & 143360
        ? (u = K(e, t))
        : e.report(30, w$1[e.getToken() & 255]);
  }
  {
    const e = 28416;
    t =
      ((t | e) ^ e) |
      65536 |
      (s ? 2048 : 0) |
      (l ? 1024 : 0) |
      (l ? 0 : 262144);
  }
  f = f?.createChildScope(256);
  const p = In(e, (t | 8192) & -524289, f, r, 0, 1),
    m = 524428,
    h = rn(e, ((t | m) ^ m) | 36864, f?.createChildScope(64), r, 8, d, f);
  return e.finishNode(
    {
      type: "FunctionDeclaration",
      id: u,
      params: p,
      body: h,
      async: s === 1,
      generator: l === 1,
    },
    c,
  );
}
function En(e, t, n, r, i, a) {
  A$1(e, t | 32);
  let o = Le(e, t, 8391476),
    s = (r ? 2048 : 0) | (o ? 1024 : 0),
    c = null,
    l,
    u = e.createScopeIfLexical(),
    d = 552704;
  e.getToken() & 143360 &&
    (ze(e, ((t | d) ^ d) | s, e.getToken()),
    (u = u?.createChildScope(128)),
    (l = e.getToken()),
    (c = K(e, t))),
    (t = ((t | d) ^ d) | 65536 | s | (o ? 0 : 262144)),
    (u = u?.createChildScope(256));
  const f = In(e, (t | 8192) & -524289, u, n, i, 1),
    p = rn(e, (t & -131229) | 36864, u?.createChildScope(64), n, 0, l, u);
  return (
    (e.assignable = 2),
    e.finishNode(
      {
        type: "FunctionExpression",
        id: c,
        params: f,
        body: p,
        async: r === 1,
        generator: o === 1,
      },
      a,
    )
  );
}
function Dn(e, t, n, r, i) {
  const a = Y(e, t, void 0, n, r, i, 0, 2, 0);
  return (
    e.destructible & 64 && e.report(63), e.destructible & 8 && e.report(62), a
  );
}
function Y(e, t, n, r, i, a, o, s, c) {
  const { tokenStart: l } = e;
  A$1(e, t | 32);
  let u = [],
    d = 0;
  for (t = (t | 131072) ^ 131072; e.getToken() !== 20; )
    if (E$1(e, t | 32, 18)) u.push(null);
    else {
      let i,
        { tokenStart: l, tokenValue: f } = e,
        p = e.getToken();
      if (p & 143360)
        if (((i = G(e, t, r, s, 0, 1, a, 1, l)), e.getToken() === 1077936155)) {
          e.assignable & 2 && e.report(26),
            A$1(e, t | 32),
            n?.addVarOrBlock(t, f, s, c);
          const u = L$1(e, t, r, 1, a, e.tokenStart);
          (i = e.finishNode(
            o
              ? {
                  type: "AssignmentPattern",
                  left: i,
                  right: u,
                }
              : {
                  type: "AssignmentExpression",
                  operator: "=",
                  left: i,
                  right: u,
                },
            l,
          )),
            (d |=
              e.destructible & 256
                ? 256
                : 0 | (e.destructible & 128)
                  ? 128
                  : 0);
        } else
          e.getToken() === 18 || e.getToken() === 20
            ? (e.assignable & 2 ? (d |= 16) : n?.addVarOrBlock(t, f, s, c),
              (d |=
                e.destructible & 256
                  ? 256
                  : 0 | (e.destructible & 128)
                    ? 128
                    : 0))
            : ((d |= s & 1 ? 32 : s & 2 ? 0 : 16),
              (i = W(e, t, r, i, a, 0, l)),
              e.getToken() !== 18 && e.getToken() !== 20
                ? (e.getToken() !== 1077936155 && (d |= 16),
                  (i = B$1(e, t, r, a, o, l, i)))
                : e.getToken() !== 1077936155 &&
                  (d |= e.assignable & 2 ? 16 : 32));
      else
        p & 2097152
          ? ((i =
              e.getToken() === 2162700
                ? Q(e, t, n, r, 0, a, o, s, c)
                : Y(e, t, n, r, 0, a, o, s, c)),
            (d |= e.destructible),
            (e.assignable = e.destructible & 16 ? 2 : 1),
            e.getToken() === 18 || e.getToken() === 20
              ? e.assignable & 2 && (d |= 16)
              : e.destructible & 8
                ? e.report(71)
                : ((i = W(e, t, r, i, a, 0, l)),
                  (d = e.assignable & 2 ? 16 : 0),
                  e.getToken() !== 18 && e.getToken() !== 20
                    ? (i = B$1(e, t, r, a, o, l, i))
                    : e.getToken() !== 1077936155 &&
                      (d |= e.assignable & 2 ? 16 : 32)))
          : p === 14
            ? ((i = X(e, t, n, r, 20, s, c, 0, a, o)),
              (d |= e.destructible),
              e.getToken() !== 18 &&
                e.getToken() !== 20 &&
                e.report(30, w$1[e.getToken() & 255]))
            : ((i = U(e, t, r, 1, 0, 1)),
              e.getToken() !== 18 && e.getToken() !== 20
                ? ((i = B$1(e, t, r, a, o, l, i)),
                  !(s & 3) && p === 67174411 && (d |= 16))
                : e.assignable & 2
                  ? (d |= 16)
                  : p === 67174411 &&
                    (d |= e.assignable & 1 && s & 3 ? 32 : 16));
      if ((u.push(i), E$1(e, t | 32, 18))) {
        if (e.getToken() === 20) break;
      } else break;
    }
  D$1(e, t, 20);
  const f = e.finishNode(
    {
      type: o ? "ArrayPattern" : "ArrayExpression",
      elements: u,
    },
    l,
  );
  return !i && e.getToken() & 4194304
    ? On(e, t, r, d, a, o, l, f)
    : ((e.destructible = d), f);
}
function On(e, t, n, r, i, a, o, s) {
  e.getToken() !== 1077936155 && e.report(26),
    A$1(e, t | 32),
    r & 16 && e.report(26),
    a || O(e, s);
  const { tokenStart: c } = e,
    l = L$1(e, t, n, 1, i, c);
  return (
    (e.destructible =
      ((r | 72) ^ 72) |
      (e.destructible & 128 ? 128 : 0) |
      (e.destructible & 256 ? 256 : 0)),
    e.finishNode(
      a
        ? {
            type: "AssignmentPattern",
            left: s,
            right: l,
          }
        : {
            type: "AssignmentExpression",
            left: s,
            operator: "=",
            right: l,
          },
      o,
    )
  );
}
function X(e, t, n, r, i, a, o, s, c, l) {
  const { tokenStart: u } = e;
  A$1(e, t | 32);
  let d = null,
    f = 0,
    { tokenValue: p, tokenStart: m } = e,
    h = e.getToken();
  if (h & 143360)
    (e.assignable = 1),
      (d = G(e, t, r, a, 0, 1, c, 1, m)),
      (h = e.getToken()),
      (d = W(e, t, r, d, c, 0, m)),
      e.getToken() !== 18 &&
        e.getToken() !== i &&
        (e.assignable & 2 && e.getToken() === 1077936155 && e.report(71),
        (f |= 16),
        (d = B$1(e, t, r, c, l, m, d))),
      e.assignable & 2
        ? (f |= 16)
        : h === i || h === 18
          ? n?.addVarOrBlock(t, p, a, o)
          : (f |= 32),
      (f |= e.destructible & 128 ? 128 : 0);
  else if (h === i) e.report(41);
  else if (h & 2097152)
    (d =
      e.getToken() === 2162700
        ? Q(e, t, n, r, 1, c, l, a, o)
        : Y(e, t, n, r, 1, c, l, a, o)),
      (h = e.getToken()),
      h !== 1077936155 && h !== i && h !== 18
        ? (e.destructible & 8 && e.report(71),
          (d = W(e, t, r, d, c, 0, m)),
          (f |= e.assignable & 2 ? 16 : 0),
          (e.getToken() & 4194304) === 4194304
            ? (e.getToken() !== 1077936155 && (f |= 16),
              (d = B$1(e, t, r, c, l, m, d)))
            : ((e.getToken() & 8388608) === 8388608 &&
                (d = H$1(e, t, r, 1, m, 4, h, d)),
              E$1(e, t | 32, 22) && (d = V$1(e, t, r, d, m)),
              (f |= e.assignable & 2 ? 16 : 32)))
        : (f |= i === 1074790415 && h !== 1077936155 ? 16 : e.destructible);
  else {
    (f |= 32), (d = U(e, t, r, 1, c, 1));
    const { tokenStart: n } = e,
      a = e.getToken();
    return (
      a === 1077936155
        ? (e.assignable & 2 && e.report(26),
          (d = B$1(e, t, r, c, l, n, d)),
          (f |= 16))
        : (a === 18 ? (f |= 16) : a !== i && (d = B$1(e, t, r, c, l, n, d)),
          (f |= e.assignable & 1 ? 32 : 16)),
      (e.destructible = f),
      e.getToken() !== i && e.getToken() !== 18 && e.report(161),
      e.finishNode(
        {
          type: l ? "RestElement" : "SpreadElement",
          argument: d,
        },
        u,
      )
    );
  }
  if (e.getToken() !== i)
    if ((a & 1 && (f |= s ? 16 : 32), E$1(e, t | 32, 1077936155))) {
      f & 16 && e.report(26), O(e, d);
      const n = L$1(e, t, r, 1, c, e.tokenStart);
      (d = e.finishNode(
        l
          ? {
              type: "AssignmentPattern",
              left: d,
              right: n,
            }
          : {
              type: "AssignmentExpression",
              left: d,
              operator: "=",
              right: n,
            },
        m,
      )),
        (f = 16);
    } else f |= 16;
  return (
    (e.destructible = f),
    e.finishNode(
      {
        type: l ? "RestElement" : "SpreadElement",
        argument: d,
      },
      u,
    )
  );
}
function Z$1(e, t, n, r, i, a) {
  const o = 11264 | (r & 64 ? 0 : 16896);
  t =
    ((t | o) ^ o) |
    (r & 8 ? 1024 : 0) |
    (r & 16 ? 2048 : 0) |
    (r & 64 ? 16384 : 0) |
    98560;
  let s = e.createScopeIfLexical(256),
    c = An(e, (t | 8192) & -524289, s, n, r, 1, i);
  s = s?.createChildScope(64);
  const l = rn(e, (t & -655373) | 36864, s, n, 0, void 0, s?.parent);
  return e.finishNode(
    {
      type: "FunctionExpression",
      params: c,
      body: l,
      async: (r & 16) > 0,
      generator: (r & 8) > 0,
      id: null,
    },
    a,
  );
}
function kn(e, t, n, r, i) {
  const a = Q(e, t, void 0, n, r, i, 0, 2, 0);
  return (
    e.destructible & 64 && e.report(63), e.destructible & 8 && e.report(62), a
  );
}
function Q(e, t, n, r, i, a, o, s, c) {
  const { tokenStart: l } = e;
  A$1(e, t);
  let u = [],
    d = 0,
    f = 0;
  for (t = (t | 131072) ^ 131072; e.getToken() !== 1074790415; ) {
    const { tokenValue: i, tokenStart: l } = e,
      p = e.getToken();
    if (p === 14) u.push(X(e, t, n, r, 1074790415, s, c, 0, a, o));
    else {
      let m = 0,
        h = null,
        g;
      if (
        e.getToken() & 143360 ||
        e.getToken() === -2147483528 ||
        e.getToken() === -2147483527
      )
        if (
          (e.getToken() === -2147483527 && (d |= 16),
          (h = K(e, t)),
          e.getToken() === 18 ||
            e.getToken() === 1074790415 ||
            e.getToken() === 1077936155)
        )
          if (
            ((m |= 4),
            t & 1 && (p & 537079808) === 537079808
              ? (d |= 16)
              : Re(e, t, s, p, 0),
            n?.addVarOrBlock(t, i, s, c),
            E$1(e, t | 32, 1077936155))
          ) {
            d |= 8;
            const n = L$1(e, t, r, 1, a, e.tokenStart);
            (d |=
              e.destructible & 256
                ? 256
                : 0 | (e.destructible & 128)
                  ? 128
                  : 0),
              (g = e.finishNode(
                {
                  type: "AssignmentPattern",
                  left: e.options.uniqueKeyInPattern ? Object.assign({}, h) : h,
                  right: n,
                },
                l,
              ));
          } else
            (d |= (p === 209006 ? 128 : 0) | (p === -2147483528 ? 16 : 0)),
              (g = e.options.uniqueKeyInPattern ? Object.assign({}, h) : h);
        else if (E$1(e, t | 32, 21)) {
          const { tokenStart: l } = e;
          if ((i === "__proto__" && f++, e.getToken() & 143360)) {
            const i = e.getToken(),
              u = e.tokenValue;
            g = G(e, t, r, s, 0, 1, a, 1, l);
            const f = e.getToken();
            (g = W(e, t, r, g, a, 0, l)),
              e.getToken() === 18 || e.getToken() === 1074790415
                ? f === 1077936155 || f === 1074790415 || f === 18
                  ? ((d |= e.destructible & 128 ? 128 : 0),
                    e.assignable & 2
                      ? (d |= 16)
                      : (i & 143360) === 143360 && n?.addVarOrBlock(t, u, s, c))
                  : (d |= e.assignable & 1 ? 32 : 16)
                : (e.getToken() & 4194304) === 4194304
                  ? (e.assignable & 2
                      ? (d |= 16)
                      : f === 1077936155
                        ? n?.addVarOrBlock(t, u, s, c)
                        : (d |= 32),
                    (g = B$1(e, t, r, a, o, l, g)))
                  : ((d |= 16),
                    (e.getToken() & 8388608) === 8388608 &&
                      (g = H$1(e, t, r, 1, l, 4, f, g)),
                    E$1(e, t | 32, 22) && (g = V$1(e, t, r, g, l)));
          } else
            (e.getToken() & 2097152) === 2097152
              ? ((g =
                  e.getToken() === 69271571
                    ? Y(e, t, n, r, 0, a, o, s, c)
                    : Q(e, t, n, r, 0, a, o, s, c)),
                (d = e.destructible),
                (e.assignable = d & 16 ? 2 : 1),
                e.getToken() === 18 || e.getToken() === 1074790415
                  ? e.assignable & 2 && (d |= 16)
                  : e.destructible & 8
                    ? e.report(71)
                    : ((g = W(e, t, r, g, a, 0, l)),
                      (d = e.assignable & 2 ? 16 : 0),
                      (e.getToken() & 4194304) === 4194304
                        ? (g = Qt(e, t, r, a, o, l, g))
                        : ((e.getToken() & 8388608) === 8388608 &&
                            (g = H$1(e, t, r, 1, l, 4, p, g)),
                          E$1(e, t | 32, 22) && (g = V$1(e, t, r, g, l)),
                          (d |= e.assignable & 2 ? 16 : 32))))
              : ((g = U(e, t, r, 1, a, 1)),
                (d |= e.assignable & 1 ? 32 : 16),
                e.getToken() === 18 || e.getToken() === 1074790415
                  ? e.assignable & 2 && (d |= 16)
                  : ((g = W(e, t, r, g, a, 0, l)),
                    (d = e.assignable & 2 ? 16 : 0),
                    e.getToken() !== 18 &&
                      p !== 1074790415 &&
                      (e.getToken() !== 1077936155 && (d |= 16),
                      (g = B$1(e, t, r, a, o, l, g)))));
        } else
          e.getToken() === 69271571
            ? ((d |= 16),
              p === 209005 && (m |= 16),
              (m |= (p === 209008 ? 256 : p === 209009 ? 512 : 1) | 2),
              (h = $$1(e, t, r, a)),
              (d |= e.assignable),
              (g = Z$1(e, t, r, m, a, e.tokenStart)))
            : e.getToken() & 143360
              ? ((d |= 16),
                p === -2147483528 && e.report(95),
                p === 209005
                  ? (e.flags & 1 && e.report(132), (m |= 17))
                  : p === 209008
                    ? (m |= 256)
                    : p === 209009
                      ? (m |= 512)
                      : e.report(0),
                (h = K(e, t)),
                (g = Z$1(e, t, r, m, a, e.tokenStart)))
              : e.getToken() === 67174411
                ? ((d |= 16), (m |= 1), (g = Z$1(e, t, r, m, a, e.tokenStart)))
                : e.getToken() === 8391476
                  ? ((d |= 16),
                    p === 209008
                      ? e.report(42)
                      : p === 209009
                        ? e.report(43)
                        : p !== 209005 && e.report(30, w$1[52]),
                    A$1(e, t),
                    (m |= 9 | (p === 209005 ? 16 : 0)),
                    e.getToken() & 143360
                      ? (h = K(e, t))
                      : (e.getToken() & 134217728) === 134217728
                        ? (h = q(e, t))
                        : e.getToken() === 69271571
                          ? ((m |= 2),
                            (h = $$1(e, t, r, a)),
                            (d |= e.assignable))
                          : e.report(30, w$1[e.getToken() & 255]),
                    (g = Z$1(e, t, r, m, a, e.tokenStart)))
                  : (e.getToken() & 134217728) === 134217728
                    ? (p === 209005 && (m |= 16),
                      (m |= p === 209008 ? 256 : p === 209009 ? 512 : 1),
                      (d |= 16),
                      (h = q(e, t)),
                      (g = Z$1(e, t, r, m, a, e.tokenStart)))
                    : e.report(133);
      else if ((e.getToken() & 134217728) === 134217728)
        if (((h = q(e, t)), e.getToken() === 21)) {
          D$1(e, t | 32, 21);
          const { tokenStart: l } = e;
          if ((i === "__proto__" && f++, e.getToken() & 143360)) {
            g = G(e, t, r, s, 0, 1, a, 1, l);
            const { tokenValue: i } = e,
              u = e.getToken();
            (g = W(e, t, r, g, a, 0, l)),
              e.getToken() === 18 || e.getToken() === 1074790415
                ? u === 1077936155 || u === 1074790415 || u === 18
                  ? e.assignable & 2
                    ? (d |= 16)
                    : n?.addVarOrBlock(t, i, s, c)
                  : (d |= e.assignable & 1 ? 32 : 16)
                : e.getToken() === 1077936155
                  ? (e.assignable & 2 && (d |= 16),
                    (g = B$1(e, t, r, a, o, l, g)))
                  : ((d |= 16), (g = B$1(e, t, r, a, o, l, g)));
          } else
            (e.getToken() & 2097152) === 2097152
              ? ((g =
                  e.getToken() === 69271571
                    ? Y(e, t, n, r, 0, a, o, s, c)
                    : Q(e, t, n, r, 0, a, o, s, c)),
                (d = e.destructible),
                (e.assignable = d & 16 ? 2 : 1),
                e.getToken() === 18 || e.getToken() === 1074790415
                  ? e.assignable & 2 && (d |= 16)
                  : (e.destructible & 8) !== 8 &&
                    ((g = W(e, t, r, g, a, 0, l)),
                    (d = e.assignable & 2 ? 16 : 0),
                    (e.getToken() & 4194304) === 4194304
                      ? (g = Qt(e, t, r, a, o, l, g))
                      : ((e.getToken() & 8388608) === 8388608 &&
                          (g = H$1(e, t, r, 1, l, 4, p, g)),
                        E$1(e, t | 32, 22) && (g = V$1(e, t, r, g, l)),
                        (d |= e.assignable & 2 ? 16 : 32))))
              : ((g = U(e, t, r, 1, 0, 1)),
                (d |= e.assignable & 1 ? 32 : 16),
                e.getToken() === 18 || e.getToken() === 1074790415
                  ? e.assignable & 2 && (d |= 16)
                  : ((g = W(e, t, r, g, a, 0, l)),
                    (d = e.assignable & 1 ? 0 : 16),
                    e.getToken() !== 18 &&
                      e.getToken() !== 1074790415 &&
                      (e.getToken() !== 1077936155 && (d |= 16),
                      (g = B$1(e, t, r, a, o, l, g)))));
        } else
          e.getToken() === 67174411
            ? ((m |= 1),
              (g = Z$1(e, t, r, m, a, e.tokenStart)),
              (d = e.assignable | 16))
            : e.report(134);
      else if (e.getToken() === 69271571)
        if (
          ((h = $$1(e, t, r, a)),
          (d |= e.destructible & 256 ? 256 : 0),
          (m |= 2),
          e.getToken() === 21)
        ) {
          A$1(e, t | 32);
          const { tokenStart: i, tokenValue: l } = e,
            u = e.getToken();
          if (e.getToken() & 143360) {
            g = G(e, t, r, s, 0, 1, a, 1, i);
            const f = e.getToken();
            (g = W(e, t, r, g, a, 0, i)),
              (e.getToken() & 4194304) === 4194304
                ? ((d |= e.assignable & 2 ? 16 : f === 1077936155 ? 0 : 32),
                  (g = Qt(e, t, r, a, o, i, g)))
                : e.getToken() === 18 || e.getToken() === 1074790415
                  ? f === 1077936155 || f === 1074790415 || f === 18
                    ? e.assignable & 2
                      ? (d |= 16)
                      : (u & 143360) === 143360 && n?.addVarOrBlock(t, l, s, c)
                    : (d |= e.assignable & 1 ? 32 : 16)
                  : ((d |= 16), (g = B$1(e, t, r, a, o, i, g)));
          } else
            (e.getToken() & 2097152) === 2097152
              ? ((g =
                  e.getToken() === 69271571
                    ? Y(e, t, n, r, 0, a, o, s, c)
                    : Q(e, t, n, r, 0, a, o, s, c)),
                (d = e.destructible),
                (e.assignable = d & 16 ? 2 : 1),
                e.getToken() === 18 || e.getToken() === 1074790415
                  ? e.assignable & 2 && (d |= 16)
                  : d & 8
                    ? e.report(62)
                    : ((g = W(e, t, r, g, a, 0, i)),
                      (d = e.assignable & 2 ? d | 16 : 0),
                      (e.getToken() & 4194304) === 4194304
                        ? (e.getToken() !== 1077936155 && (d |= 16),
                          (g = Qt(e, t, r, a, o, i, g)))
                        : ((e.getToken() & 8388608) === 8388608 &&
                            (g = H$1(e, t, r, 1, i, 4, p, g)),
                          E$1(e, t | 32, 22) && (g = V$1(e, t, r, g, i)),
                          (d |= e.assignable & 2 ? 16 : 32))))
              : ((g = U(e, t, r, 1, 0, 1)),
                (d |= e.assignable & 1 ? 32 : 16),
                e.getToken() === 18 || e.getToken() === 1074790415
                  ? e.assignable & 2 && (d |= 16)
                  : ((g = W(e, t, r, g, a, 0, i)),
                    (d = e.assignable & 1 ? 0 : 16),
                    e.getToken() !== 18 &&
                      e.getToken() !== 1074790415 &&
                      (e.getToken() !== 1077936155 && (d |= 16),
                      (g = B$1(e, t, r, a, o, i, g)))));
        } else
          e.getToken() === 67174411
            ? ((m |= 1), (g = Z$1(e, t, r, m, a, e.tokenStart)), (d = 16))
            : e.report(44);
      else if (p === 8391476)
        if ((D$1(e, t | 32, 8391476), (m |= 8), e.getToken() & 143360)) {
          const n = e.getToken();
          if (((h = K(e, t)), (m |= 1), e.getToken() === 67174411))
            (d |= 16), (g = Z$1(e, t, r, m, a, e.tokenStart));
          else
            throw new C$1(
              e.tokenStart,
              e.currentLocation,
              n === 209005
                ? 46
                : n === 209008 || e.getToken() === 209009
                  ? 45
                  : 47,
              w$1[n & 255],
            );
        } else
          (e.getToken() & 134217728) === 134217728
            ? ((d |= 16),
              (h = q(e, t)),
              (m |= 1),
              (g = Z$1(e, t, r, m, a, e.tokenStart)))
            : e.getToken() === 69271571
              ? ((d |= 16),
                (m |= 3),
                (h = $$1(e, t, r, a)),
                (g = Z$1(e, t, r, m, a, e.tokenStart)))
              : e.report(126);
      else e.report(30, w$1[p & 255]);
      (d |= e.destructible & 128 ? 128 : 0),
        (e.destructible = d),
        u.push(
          e.finishNode(
            {
              type: "Property",
              key: h,
              value: g,
              kind: m & 768 ? (m & 512 ? "set" : "get") : "init",
              computed: (m & 2) > 0,
              method: (m & 1) > 0,
              shorthand: (m & 4) > 0,
            },
            l,
          ),
        );
    }
    if (((d |= e.destructible), e.getToken() !== 18)) break;
    A$1(e, t);
  }
  D$1(e, t, 1074790415), f > 1 && (d |= 64);
  const p = e.finishNode(
    {
      type: o ? "ObjectPattern" : "ObjectExpression",
      properties: u,
    },
    l,
  );
  return !i && e.getToken() & 4194304
    ? On(e, t, r, d, a, o, l, p)
    : ((e.destructible = d), p);
}
function An(e, t, n, r, i, a, o) {
  D$1(e, t, 67174411);
  const s = [];
  if (((e.flags = (e.flags | 128) ^ 128), e.getToken() === 16))
    return i & 512 && e.report(37, "Setter", "one", ""), A$1(e, t), s;
  i & 256 && e.report(37, "Getter", "no", "s"),
    i & 512 && e.getToken() === 14 && e.report(38),
    (t = (t | 131072) ^ 131072);
  let c = 0,
    l = 0;
  for (; e.getToken() !== 18; ) {
    let u = null,
      { tokenStart: d } = e;
    if (
      (e.getToken() & 143360
        ? (t & 1 ||
            ((e.getToken() & 36864) === 36864 && (e.flags |= 256),
            (e.getToken() & 537079808) === 537079808 && (e.flags |= 512)),
          (u = Qn(e, t, n, i | 1, 0)))
        : (e.getToken() === 2162700
            ? (u = Q(e, t, n, r, 1, o, 1, a, 0))
            : e.getToken() === 69271571
              ? (u = Y(e, t, n, r, 1, o, 1, a, 0))
              : e.getToken() === 14 && (u = X(e, t, n, r, 16, a, 0, 0, o, 1)),
          (l = 1),
          e.destructible & 48 && e.report(50)),
      e.getToken() === 1077936155)
    ) {
      A$1(e, t | 32), (l = 1);
      const n = L$1(e, t, r, 1, 0, e.tokenStart);
      u = e.finishNode(
        {
          type: "AssignmentPattern",
          left: u,
          right: n,
        },
        d,
      );
    }
    if ((c++, s.push(u), !E$1(e, t, 18) || e.getToken() === 16)) break;
  }
  return (
    i & 512 && c !== 1 && e.report(37, "Setter", "one", ""),
    n?.reportScopeError(),
    l && (e.flags |= 128),
    D$1(e, t, 16),
    s
  );
}
function $$1(e, t, n, r) {
  A$1(e, t | 32);
  const i = L$1(e, (t | 131072) ^ 131072, n, 1, r, e.tokenStart);
  return D$1(e, t, 20), i;
}
function jn(e, t, n, r, i, a, o) {
  e.flags = (e.flags | 128) ^ 128;
  const s = e.tokenStart;
  A$1(e, t | 262176);
  const c = e.createScopeIfLexical()?.createChildScope(512);
  if (((t = (t | 131072) ^ 131072), E$1(e, t, 16)))
    return Pn(e, t, c, n, [], r, 0, o);
  let l = 0;
  e.destructible &= -385;
  let u,
    d = [],
    f = 0,
    p = 0,
    m = 0,
    h = e.tokenStart;
  for (e.assignable = 1; e.getToken() !== 16; ) {
    const { tokenStart: r } = e,
      o = e.getToken();
    if (o & 143360)
      c?.addBlockName(t, e.tokenValue, 1, 0),
        (o & 537079808) === 537079808
          ? (p = 1)
          : (o & 36864) === 36864 && (m = 1),
        (u = G(e, t, n, i, 0, 1, 1, 1, r)),
        e.getToken() === 16 || e.getToken() === 18
          ? e.assignable & 2 && ((l |= 16), (p = 1))
          : (e.getToken() === 1077936155 ? (p = 1) : (l |= 16),
            (u = W(e, t, n, u, 1, 0, r)),
            e.getToken() !== 16 &&
              e.getToken() !== 18 &&
              (u = B$1(e, t, n, 1, 0, r, u)));
    else if ((o & 2097152) === 2097152)
      (u =
        o === 2162700
          ? Q(e, t | 262144, c, n, 0, 1, 0, i, a)
          : Y(e, t | 262144, c, n, 0, 1, 0, i, a)),
        (l |= e.destructible),
        (p = 1),
        (e.assignable = 2),
        e.getToken() !== 16 &&
          e.getToken() !== 18 &&
          (l & 8 && e.report(122),
          (u = W(e, t, n, u, 0, 0, r)),
          (l |= 16),
          e.getToken() !== 16 &&
            e.getToken() !== 18 &&
            (u = B$1(e, t, n, 0, 0, r, u)));
    else if (o === 14) {
      (u = X(e, t, c, n, 16, i, a, 0, 1, 0)),
        e.destructible & 16 && e.report(74),
        (p = 1),
        f && (e.getToken() === 16 || e.getToken() === 18) && d.push(u),
        (l |= 8);
      break;
    } else {
      if (
        ((l |= 16),
        (u = L$1(e, t, n, 1, 1, r)),
        f && (e.getToken() === 16 || e.getToken() === 18) && d.push(u),
        e.getToken() === 18 && (f || ((f = 1), (d = [u]))),
        f)
      ) {
        for (; E$1(e, t | 32, 18); ) d.push(L$1(e, t, n, 1, 1, e.tokenStart));
        (e.assignable = 2),
          (u = e.finishNode(
            {
              type: "SequenceExpression",
              expressions: d,
            },
            h,
          ));
      }
      return (
        D$1(e, t, 16),
        (e.destructible = l),
        e.options.preserveParens
          ? e.finishNode(
              {
                type: "ParenthesizedExpression",
                expression: u,
              },
              s,
            )
          : u
      );
    }
    if (
      (f && (e.getToken() === 16 || e.getToken() === 18) && d.push(u),
      !E$1(e, t | 32, 18))
    )
      break;
    if ((f || ((f = 1), (d = [u])), e.getToken() === 16)) {
      l |= 8;
      break;
    }
  }
  return (
    f &&
      ((e.assignable = 2),
      (u = e.finishNode(
        {
          type: "SequenceExpression",
          expressions: d,
        },
        h,
      ))),
    D$1(e, t, 16),
    l & 16 && l & 8 && e.report(151),
    (l |= e.destructible & 256 ? 256 : 0 | (e.destructible & 128) ? 128 : 0),
    e.getToken() === 10
      ? (l & 48 && e.report(49),
        t & 2050 && l & 128 && e.report(31),
        t & 1025 && l & 256 && e.report(32),
        p && (e.flags |= 128),
        m && (e.flags |= 256),
        Pn(e, t, c, n, f ? d : [u], r, 0, o))
      : (l & 64 && e.report(63),
        l & 8 && e.report(144),
        (e.destructible = ((e.destructible | 256) ^ 256) | l),
        e.options.preserveParens
          ? e.finishNode(
              {
                type: "ParenthesizedExpression",
                expression: u,
              },
              s,
            )
          : u)
  );
}
function Mn(e, t, n) {
  let { tokenStart: r } = e,
    { tokenValue: i } = e,
    a = 0,
    o = 0;
  (e.getToken() & 537079808) === 537079808
    ? (a = 1)
    : (e.getToken() & 36864) === 36864 && (o = 1);
  const s = K(e, t);
  if (((e.assignable = 1), e.getToken() === 10)) {
    const c = e.options.lexical ? lt(e, t, i) : void 0;
    return (
      a && (e.flags |= 128), o && (e.flags |= 256), Fn(e, t, c, n, [s], 0, r)
    );
  }
  return s;
}
function Nn(e, t, n, r, i, a, o, s, c) {
  return (
    o || e.report(57),
    a && e.report(51),
    (e.flags &= -129),
    Fn(e, t, e.options.lexical ? lt(e, t, r) : void 0, n, [i], s, c)
  );
}
function Pn(e, t, n, r, i, a, o, s) {
  a || e.report(57);
  for (let t = 0; t < i.length; ++t) O(e, i[t]);
  return Fn(e, t, n, r, i, o, s);
}
function Fn(e, t, n, r, i, a, o) {
  e.flags & 1 && e.report(48), D$1(e, t | 32, 10);
  const s = 535552;
  t = ((t | s) ^ s) | (a ? 2048 : 0);
  let c = e.getToken() !== 2162700,
    l;
  if ((n?.reportScopeError(), c))
    (e.flags = (e.flags | 4928) ^ 4928), (l = L$1(e, t, r, 1, 0, e.tokenStart));
  else {
    n = n?.createChildScope(64);
    const i = 131084;
    switch (
      ((l = rn(e, ((t | i) ^ i) | 4096, n, r, 16, void 0, void 0)),
      e.getToken())
    ) {
      case 69271571:
        e.flags & 1 || e.report(116);
        break;
      case 67108877:
      case 67174409:
      case 22:
        e.report(117);
      case 67174411:
        e.flags & 1 || e.report(116), (e.flags |= 1024);
    }
    (e.getToken() & 8388608) === 8388608 &&
      !(e.flags & 1) &&
      e.report(30, w$1[e.getToken() & 255]),
      (e.getToken() & 33619968) === 33619968 && e.report(125);
  }
  return (
    (e.assignable = 2),
    e.finishNode(
      {
        type: "ArrowFunctionExpression",
        params: i,
        body: l,
        async: a === 1,
        expression: c,
        generator: !1,
      },
      o,
    )
  );
}
function In(e, t, n, r, i, a) {
  D$1(e, t, 67174411), (e.flags = (e.flags | 128) ^ 128);
  const o = [];
  if (E$1(e, t, 16)) return o;
  t = (t | 131072) ^ 131072;
  let s = 0;
  for (; e.getToken() !== 18; ) {
    let c,
      { tokenStart: l } = e,
      u = e.getToken();
    if (
      (u & 143360
        ? (t & 1 ||
            ((u & 36864) === 36864 && (e.flags |= 256),
            (u & 537079808) === 537079808 && (e.flags |= 512)),
          (c = Qn(e, t, n, a | 1, 0)))
        : (u === 2162700
            ? (c = Q(e, t, n, r, 1, i, 1, a, 0))
            : u === 69271571
              ? (c = Y(e, t, n, r, 1, i, 1, a, 0))
              : u === 14
                ? (c = X(e, t, n, r, 16, a, 0, 0, i, 1))
                : e.report(30, w$1[u & 255]),
          (s = 1),
          e.destructible & 48 && e.report(50)),
      e.getToken() === 1077936155)
    ) {
      A$1(e, t | 32), (s = 1);
      const n = L$1(e, t, r, 1, i, e.tokenStart);
      c = e.finishNode(
        {
          type: "AssignmentPattern",
          left: c,
          right: n,
        },
        l,
      );
    }
    if ((o.push(c), !E$1(e, t, 18) || e.getToken() === 16)) break;
  }
  return (
    s && (e.flags |= 128),
    (s || t & 1) && n?.reportScopeError(),
    D$1(e, t, 16),
    o
  );
}
function Ln(e, t, n, r, i, a) {
  const o = e.getToken();
  if (o & 67108864) {
    if (o === 67108877) {
      A$1(e, t | 262144), (e.assignable = 1);
      const i = cn(e, t, n);
      return Ln(
        e,
        t,
        n,
        e.finishNode(
          {
            type: "MemberExpression",
            object: r,
            computed: !1,
            property: i,
            optional: !1,
          },
          a,
        ),
        0,
        a,
      );
    }
    if (o === 69271571) {
      A$1(e, t | 32);
      const { tokenStart: o } = e,
        s = z$1(e, t, n, i, 1, o);
      return (
        D$1(e, t, 20),
        (e.assignable = 1),
        Ln(
          e,
          t,
          n,
          e.finishNode(
            {
              type: "MemberExpression",
              object: r,
              computed: !0,
              property: s,
              optional: !1,
            },
            a,
          ),
          0,
          a,
        )
      );
    }
    if (o === 67174408 || o === 67174409)
      return (
        (e.assignable = 2),
        Ln(
          e,
          t,
          n,
          e.finishNode(
            {
              type: "TaggedTemplateExpression",
              tag: r,
              quasi:
                e.getToken() === 67174408 ? bn(e, t | 64, n) : yn(e, t | 64),
            },
            a,
          ),
          0,
          a,
        )
      );
  }
  return r;
}
function Rn(e, t, n, r) {
  const { tokenStart: i } = e,
    a = K(e, t | 32),
    { tokenStart: o } = e;
  if (E$1(e, t, 67108877)) {
    if (t & 65536 && e.getToken() === 209029)
      return (e.assignable = 2), zn(e, t, a, i);
    e.report(94);
  }
  (e.assignable = 2),
    (e.getToken() & 16842752) === 16842752 &&
      e.report(65, w$1[e.getToken() & 255]);
  const s = G(e, t, n, 2, 1, 0, r, 1, o);
  (t = (t | 131072) ^ 131072), e.getToken() === 67108990 && e.report(168);
  const c = Ln(e, t, n, s, r, o);
  return (
    (e.assignable = 2),
    e.finishNode(
      {
        type: "NewExpression",
        callee: c,
        arguments: e.getToken() === 67174411 ? Cn(e, t, n, r) : [],
      },
      i,
    )
  );
}
function zn(e, t, n, r) {
  const i = K(e, t);
  return e.finishNode(
    {
      type: "MetaProperty",
      meta: n,
      property: i,
    },
    r,
  );
}
function Bn(e, t, n, r, i) {
  return (
    e.getToken() === 209006 && e.report(31),
    t & 1025 && e.getToken() === 241771 && e.report(32),
    Ge(e, t, e.getToken()),
    (e.getToken() & 36864) === 36864 && (e.flags |= 256),
    Nn(e, (t & -524289) | 2048, n, e.tokenValue, K(e, t), 0, r, 1, i)
  );
}
function Vn(e, t, n, r, i, a, o, s, c) {
  A$1(e, t | 32);
  const l = e.createScopeIfLexical()?.createChildScope(512);
  if (((t = (t | 131072) ^ 131072), E$1(e, t, 16)))
    return e.getToken() === 10
      ? (s & 1 && e.report(48), Pn(e, t, l, n, [], i, 1, c))
      : e.finishNode(
          {
            type: "CallExpression",
            callee: r,
            arguments: [],
            optional: !1,
          },
          c,
        );
  let u = 0,
    d = null,
    f = 0;
  e.destructible = (e.destructible | 384) ^ 384;
  const p = [];
  for (; e.getToken() !== 16; ) {
    const { tokenStart: i } = e,
      s = e.getToken();
    if (s & 143360)
      l?.addBlockName(t, e.tokenValue, a, 0),
        (s & 537079808) === 537079808
          ? (e.flags |= 512)
          : (s & 36864) === 36864 && (e.flags |= 256),
        (d = G(e, t, n, a, 0, 1, 1, 1, i)),
        e.getToken() === 16 || e.getToken() === 18
          ? e.assignable & 2 && ((u |= 16), (f = 1))
          : (e.getToken() === 1077936155 ? (f = 1) : (u |= 16),
            (d = W(e, t, n, d, 1, 0, i)),
            e.getToken() !== 16 &&
              e.getToken() !== 18 &&
              (d = B$1(e, t, n, 1, 0, i, d)));
    else if (s & 2097152)
      (d =
        s === 2162700
          ? Q(e, t, l, n, 0, 1, 0, a, o)
          : Y(e, t, l, n, 0, 1, 0, a, o)),
        (u |= e.destructible),
        (f = 1),
        e.getToken() !== 16 &&
          e.getToken() !== 18 &&
          (u & 8 && e.report(122),
          (d = W(e, t, n, d, 0, 0, i)),
          (u |= 16),
          (e.getToken() & 8388608) === 8388608 &&
            (d = H$1(e, t, n, 1, c, 4, s, d)),
          E$1(e, t | 32, 22) && (d = V$1(e, t, n, d, c)));
    else if (s === 14)
      (d = X(e, t, l, n, 16, a, o, 1, 1, 0)),
        (u |= (e.getToken() === 16 ? 0 : 16) | e.destructible),
        (f = 1);
    else {
      for (
        d = L$1(e, t, n, 1, 0, i), u = e.assignable, p.push(d);
        E$1(e, t | 32, 18);
      )
        p.push(L$1(e, t, n, 1, 0, i));
      return (
        (u |= e.assignable),
        D$1(e, t, 16),
        (e.destructible = u | 16),
        (e.assignable = 2),
        e.finishNode(
          {
            type: "CallExpression",
            callee: r,
            arguments: p,
            optional: !1,
          },
          c,
        )
      );
    }
    if ((p.push(d), !E$1(e, t | 32, 18))) break;
  }
  return (
    D$1(e, t, 16),
    (u |= e.destructible & 256 ? 256 : 0 | (e.destructible & 128) ? 128 : 0),
    e.getToken() === 10
      ? (u & 48 && e.report(27),
        (e.flags & 1 || s & 1) && e.report(48),
        u & 128 && e.report(31),
        t & 1025 && u & 256 && e.report(32),
        f && (e.flags |= 128),
        Pn(e, t | 2048, l, n, p, i, 1, c))
      : (u & 64 && e.report(63),
        u & 8 && e.report(62),
        (e.assignable = 2),
        e.finishNode(
          {
            type: "CallExpression",
            callee: r,
            arguments: p,
            optional: !1,
          },
          c,
        ))
  );
}
function Hn(e, t) {
  const { tokenRaw: n, tokenRegExp: r, tokenValue: i, tokenStart: a } = e;
  A$1(e, t), (e.assignable = 2);
  const o = {
    type: "Literal",
    value: i,
    regex: r,
  };
  return e.options.raw && (o.raw = n), e.finishNode(o, a);
}
function Un(e, t, n, r, i) {
  let a, o;
  e.leadingDecorators.decorators.length
    ? (e.getToken() === 132 && e.report(30, "@"),
      (a = e.leadingDecorators.start),
      (o = [...e.leadingDecorators.decorators]),
      (e.leadingDecorators.decorators.length = 0))
    : ((a = e.tokenStart), (o = Gn(e, t, r))),
    (t = (t | 16385) ^ 16384),
    A$1(e, t);
  let s = null,
    c = null,
    { tokenValue: l } = e;
  e.getToken() & 4096 && e.getToken() !== 20565
    ? (Be(e, t, e.getToken()) && e.report(118),
      (e.getToken() & 537079808) === 537079808 && e.report(119),
      n &&
        (n.addBlockName(t, l, 32, 0),
        i && i & 2 && e.declareUnboundVariable(l)),
      (s = K(e, t)))
    : i & 1 || e.report(39, "Class");
  let u = t;
  E$1(e, t | 32, 20565)
    ? ((c = U(e, t, r, 0, 0, 0)), (u |= 512))
    : (u = (u | 512) ^ 512);
  const d = qn(e, u, t, n, r, 2, 8, 0);
  return e.finishNode(
    {
      type: "ClassDeclaration",
      id: s,
      superClass: c,
      body: d,
      ...(e.options.next ? { decorators: o } : null),
    },
    a,
  );
}
function Wn(e, t, n, r, i) {
  let a = null,
    o = null,
    s = Gn(e, t, n);
  (t = (t | 16385) ^ 16384),
    A$1(e, t),
    e.getToken() & 4096 &&
      e.getToken() !== 20565 &&
      (Be(e, t, e.getToken()) && e.report(118),
      (e.getToken() & 537079808) === 537079808 && e.report(119),
      (a = K(e, t)));
  let c = t;
  E$1(e, t | 32, 20565)
    ? ((o = U(e, t, n, 0, r, 0)), (c |= 512))
    : (c = (c | 512) ^ 512);
  const l = qn(e, c, t, void 0, n, 2, 0, r);
  return (
    (e.assignable = 2),
    e.finishNode(
      {
        type: "ClassExpression",
        id: a,
        superClass: o,
        body: l,
        ...(e.options.next ? { decorators: s } : null),
      },
      i,
    )
  );
}
function Gn(e, t, n) {
  const r = [];
  if (e.options.next) for (; e.getToken() === 132; ) r.push(Kn(e, t, n));
  return r;
}
function Kn(e, t, n) {
  const r = e.tokenStart;
  A$1(e, t | 32);
  let i = G(e, t, n, 2, 0, 1, 0, 1, r);
  return (
    (i = W(e, t, n, i, 0, 0, e.tokenStart)),
    e.finishNode(
      {
        type: "Decorator",
        expression: i,
      },
      r,
    )
  );
}
function qn(e, t, n, r, i, a, o, s) {
  const { tokenStart: c } = e,
    l = e.createPrivateScopeIfLexical(i);
  D$1(e, t | 32, 2162700);
  const u = 655360;
  t = (t | u) ^ u;
  const d = e.flags & 32;
  e.flags = (e.flags | 32) ^ 32;
  const f = [];
  for (; e.getToken() !== 1074790415; ) {
    const i = e.tokenStart,
      o = Gn(e, t, l);
    if (
      (o.length > 0 && e.tokenValue === "constructor" && e.report(109),
      e.getToken() === 1074790415 && e.report(108),
      E$1(e, t, 1074790417))
    ) {
      o.length > 0 && e.report(120);
      continue;
    }
    f.push(Jn(e, t, r, l, n, a, o, 0, s, o.length > 0 ? i : e.tokenStart));
  }
  return (
    D$1(e, o & 8 ? t | 32 : t, 1074790415),
    l?.validatePrivateIdentifierRefs(),
    (e.flags = (e.flags & -33) | d),
    e.finishNode(
      {
        type: "ClassBody",
        body: f,
      },
      c,
    )
  );
}
function Jn(e, t, n, r, i, a, o, s, c, l) {
  let u = s ? 32 : 0,
    d = null,
    f = e.getToken();
  if (f & 176128 || f === -2147483528)
    switch (((d = K(e, t)), f)) {
      case 36970:
        if (
          !s &&
          e.getToken() !== 67174411 &&
          (e.getToken() & 1048576) !== 1048576 &&
          e.getToken() !== 1077936155
        )
          return Jn(e, t, n, r, i, a, o, 1, c, l);
        break;
      case 209005:
        if (e.getToken() !== 67174411 && !(e.flags & 1)) {
          if ((e.getToken() & 1073741824) === 1073741824)
            return Xn(e, t, r, d, u, o, l);
          u |= 16 | (Le(e, t, 8391476) ? 8 : 0);
        }
        break;
      case 209008:
        if (e.getToken() !== 67174411) {
          if ((e.getToken() & 1073741824) === 1073741824)
            return Xn(e, t, r, d, u, o, l);
          u |= 256;
        }
        break;
      case 209009:
        if (e.getToken() !== 67174411) {
          if ((e.getToken() & 1073741824) === 1073741824)
            return Xn(e, t, r, d, u, o, l);
          u |= 512;
        }
        break;
      case 12402:
        if (e.getToken() !== 67174411 && !(e.flags & 1)) {
          if ((e.getToken() & 1073741824) === 1073741824)
            return Xn(e, t, r, d, u, o, l);
          e.options.next && (u |= 1024);
        }
    }
  else if (f === 69271571) (u |= 2), (d = $$1(e, i, r, c));
  else if ((f & 134217728) === 134217728) d = q(e, t);
  else if (f === 8391476) (u |= 8), A$1(e, t);
  else if (e.getToken() === 130) (u |= 8192), (d = Yn(e, t | 16, r, 768));
  else if ((e.getToken() & 1073741824) === 1073741824) u |= 128;
  else if (s && f === 2162700) return Lt(e, t | 16, n, r, l);
  else
    f === -2147483527
      ? ((d = K(e, t)),
        e.getToken() !== 67174411 && e.report(30, w$1[e.getToken() & 255]))
      : e.report(30, w$1[e.getToken() & 255]);
  if (
    (u & 1816 &&
      (e.getToken() & 143360 ||
      e.getToken() === -2147483528 ||
      e.getToken() === -2147483527
        ? (d = K(e, t))
        : (e.getToken() & 134217728) === 134217728
          ? (d = q(e, t))
          : e.getToken() === 69271571
            ? ((u |= 2), (d = $$1(e, t, r, 0)))
            : e.getToken() === 130
              ? ((u |= 8192), (d = Yn(e, t, r, u)))
              : e.report(135)),
    u & 2 ||
      (e.tokenValue === "constructor"
        ? ((e.getToken() & 1073741824) === 1073741824
            ? e.report(129)
            : !(u & 32) &&
              e.getToken() === 67174411 &&
              (u & 920
                ? e.report(53, "accessor")
                : t & 512 || (e.flags & 32 ? e.report(54) : (e.flags |= 32))),
          (u |= 64))
        : !(u & 8192) &&
          u & 32 &&
          e.tokenValue === "prototype" &&
          e.report(52)),
    u & 1024 || (e.getToken() !== 67174411 && !(u & 768)))
  )
    return Xn(e, t, r, d, u, o, l);
  const p = Z$1(e, t | 16, r, u, c, e.tokenStart);
  return e.finishNode(
    {
      type: "MethodDefinition",
      kind:
        !(u & 32) && u & 64
          ? "constructor"
          : u & 256
            ? "get"
            : u & 512
              ? "set"
              : "method",
      static: (u & 32) > 0,
      computed: (u & 2) > 0,
      key: d,
      value: p,
      ...(e.options.next ? { decorators: o } : null),
    },
    l,
  );
}
function Yn(e, t, n, r) {
  const { tokenStart: i } = e;
  A$1(e, t);
  const { tokenValue: a } = e;
  return (
    a === "constructor" && e.report(128),
    e.options.lexical &&
      (n || e.report(4, a),
      r ? n.addPrivateIdentifier(a, r) : n.addPrivateIdentifierRef(a)),
    A$1(e, t),
    e.finishNode(
      {
        type: "PrivateIdentifier",
        name: a,
      },
      i,
    )
  );
}
function Xn(e, t, n, r, i, a, o) {
  let s = null;
  if ((i & 8 && e.report(0), e.getToken() === 1077936155)) {
    A$1(e, t | 32);
    const { tokenStart: r } = e;
    e.getToken() === 537079927 && e.report(119);
    const a = 11264 | (i & 64 ? 0 : 16896);
    (t =
      ((t | a) ^ a) |
      (i & 8 ? 1024 : 0) |
      (i & 16 ? 2048 : 0) |
      (i & 64 ? 16384 : 0) |
      65792),
      (s = G(e, t | 16, n, 2, 0, 1, 0, 1, r)),
      ((e.getToken() & 1073741824) !== 1073741824 ||
        (e.getToken() & 4194304) === 4194304) &&
        ((s = W(e, t | 16, n, s, 0, 0, r)),
        (s = B$1(e, t | 16, n, 0, 0, r, s)));
  }
  return (
    T$1(e, t),
    e.finishNode(
      {
        type: i & 1024 ? "AccessorProperty" : "PropertyDefinition",
        key: r,
        value: s,
        static: (i & 32) > 0,
        computed: (i & 2) > 0,
        ...(e.options.next ? { decorators: a } : null),
      },
      o,
    )
  );
}
function Zn(e, t, n, r, i, a) {
  if (e.getToken() & 143360 || (!(t & 1) && e.getToken() === -2147483527))
    return Qn(e, t, n, i, a);
  (e.getToken() & 2097152) !== 2097152 && e.report(30, w$1[e.getToken() & 255]);
  const o =
    e.getToken() === 69271571
      ? Y(e, t, n, r, 1, 0, 1, i, a)
      : Q(e, t, n, r, 1, 0, 1, i, a);
  return (
    e.destructible & 16 && e.report(50), e.destructible & 32 && e.report(50), o
  );
}
function Qn(e, t, n, r, i) {
  const a = e.getToken();
  t & 1 &&
    ((a & 537079808) === 537079808
      ? e.report(119)
      : ((a & 36864) === 36864 || a === -2147483527) && e.report(118)),
    (a & 20480) === 20480 && e.report(102),
    a === 241771 && (t & 1024 && e.report(32), t & 2 && e.report(111)),
    (a & 255) === 73 && r & 24 && e.report(100),
    a === 209006 && (t & 2048 && e.report(176), t & 2 && e.report(110));
  const { tokenValue: o, tokenStart: s } = e;
  return (
    A$1(e, t),
    n?.addVarOrBlock(t, o, r, i),
    e.finishNode(
      {
        type: "Identifier",
        name: o,
      },
      s,
    )
  );
}
function $n(e, t, n, r, i) {
  if ((r || D$1(e, t, 8456256), e.getToken() === 8390721)) {
    const a = er(e, i),
      [o, s] = ir(e, t, n, r);
    return e.finishNode(
      {
        type: "JSXFragment",
        openingFragment: a,
        children: o,
        closingFragment: s,
      },
      i,
    );
  }
  e.getToken() === 8457014 && e.report(30, w$1[e.getToken() & 255]);
  let a = null,
    o = [],
    s = cr(e, t, n, r, i);
  if (!s.selfClosing) {
    [o, a] = rr(e, t, n, r);
    const i = We(a.name);
    We(s.name) !== i && e.report(155, i);
  }
  return e.finishNode(
    {
      type: "JSXElement",
      children: o,
      openingElement: s,
      closingElement: a,
    },
    i,
  );
}
function er(e, t) {
  return j(e), e.finishNode({ type: "JSXOpeningFragment" }, t);
}
function tr(e, t, n, r) {
  D$1(e, t, 8457014);
  const i = lr(e, t);
  return (
    e.getToken() !== 8390721 && e.report(25, w$1[65]),
    n ? j(e) : A$1(e, t),
    e.finishNode(
      {
        type: "JSXClosingElement",
        name: i,
      },
      r,
    )
  );
}
function nr(e, t, n, r) {
  return (
    D$1(e, t, 8457014),
    e.getToken() !== 8390721 && e.report(25, w$1[65]),
    n ? j(e) : A$1(e, t),
    e.finishNode({ type: "JSXClosingFragment" }, r)
  );
}
function rr(e, t, n, r) {
  const i = [];
  for (;;) {
    const a = ar(e, t, n, r);
    if (a.type === "JSXClosingElement") return [i, a];
    i.push(a);
  }
}
function ir(e, t, n, r) {
  const i = [];
  for (;;) {
    const a = or(e, t, n, r);
    if (a.type === "JSXClosingFragment") return [i, a];
    i.push(a);
  }
}
function ar(e, t, n, r) {
  if (e.getToken() === 137) return sr(e, t);
  if (e.getToken() === 2162700) return hr(e, t, n, 1, 0);
  if (e.getToken() === 8456256) {
    const { tokenStart: i } = e;
    return (
      A$1(e, t), e.getToken() === 8457014 ? tr(e, t, r, i) : $n(e, t, n, 1, i)
    );
  }
  e.report(0);
}
function or(e, t, n, r) {
  if (e.getToken() === 137) return sr(e, t);
  if (e.getToken() === 2162700) return hr(e, t, n, 1, 0);
  if (e.getToken() === 8456256) {
    const { tokenStart: i } = e;
    return (
      A$1(e, t), e.getToken() === 8457014 ? nr(e, t, r, i) : $n(e, t, n, 1, i)
    );
  }
  e.report(0);
}
function sr(e, t) {
  const n = e.tokenStart;
  A$1(e, t);
  const r = {
    type: "JSXText",
    value: e.tokenValue,
  };
  return e.options.raw && (r.raw = e.tokenRaw), e.finishNode(r, n);
}
function cr(e, t, n, r, i) {
  (e.getToken() & 143360) !== 143360 &&
    (e.getToken() & 4096) !== 4096 &&
    e.report(0);
  const a = lr(e, t),
    o = dr(e, t, n),
    s = e.getToken() === 8457014;
  return (
    s && D$1(e, t, 8457014),
    e.getToken() !== 8390721 && e.report(25, w$1[65]),
    r || !s ? j(e) : A$1(e, t),
    e.finishNode(
      {
        type: "JSXOpeningElement",
        name: a,
        attributes: o,
        selfClosing: s,
      },
      i,
    )
  );
}
function lr(e, t) {
  const { tokenStart: n } = e;
  st(e);
  let r = vr(e, t);
  if (e.getToken() === 21) return mr(e, t, r, n);
  for (; E$1(e, t, 67108877); ) st(e), (r = ur(e, t, r, n));
  return r;
}
function ur(e, t, n, r) {
  const i = vr(e, t);
  return e.finishNode(
    {
      type: "JSXMemberExpression",
      object: n,
      property: i,
    },
    r,
  );
}
function dr(e, t, n) {
  const r = [];
  for (
    ;
    e.getToken() !== 8457014 &&
    e.getToken() !== 8390721 &&
    e.getToken() !== 1048576;
  )
    r.push(pr(e, t, n));
  return r;
}
function fr(e, t, n) {
  const r = e.tokenStart;
  A$1(e, t), D$1(e, t, 14);
  const i = L$1(e, t, n, 1, 0, e.tokenStart);
  return (
    D$1(e, t, 1074790415),
    e.finishNode(
      {
        type: "JSXSpreadAttribute",
        argument: i,
      },
      r,
    )
  );
}
function pr(e, t, n) {
  const { tokenStart: r } = e;
  if (e.getToken() === 2162700) return fr(e, t, n);
  st(e);
  let i = null,
    a = vr(e, t);
  if (
    (e.getToken() === 21 && (a = mr(e, t, a, r)), e.getToken() === 1077936155)
  )
    switch (at(e, t)) {
      case 134283267:
        i = q(e, t);
        break;
      case 8456256:
        i = $n(e, t, n, 0, e.tokenStart);
        break;
      case 2162700:
        i = hr(e, t, n, 0, 1);
        break;
      default:
        e.report(154);
    }
  return e.finishNode(
    {
      type: "JSXAttribute",
      value: i,
      name: a,
    },
    r,
  );
}
function mr(e, t, n, r) {
  D$1(e, t, 21);
  const i = vr(e, t);
  return e.finishNode(
    {
      type: "JSXNamespacedName",
      namespace: n,
      name: i,
    },
    r,
  );
}
function hr(e, t, n, r, i) {
  const { tokenStart: a } = e;
  A$1(e, t | 32);
  const { tokenStart: o } = e;
  if (e.getToken() === 14) return gr(e, t, n, a);
  let s = null;
  return (
    e.getToken() === 1074790415
      ? (i && e.report(157),
        (s = _r(e, {
          index: e.startIndex,
          line: e.startLine,
          column: e.startColumn,
        })))
      : (s = L$1(e, t, n, 1, 0, o)),
    e.getToken() !== 1074790415 && e.report(25, w$1[15]),
    r ? j(e) : A$1(e, t),
    e.finishNode(
      {
        type: "JSXExpressionContainer",
        expression: s,
      },
      a,
    )
  );
}
function gr(e, t, n, r) {
  D$1(e, t, 14);
  const i = L$1(e, t, n, 1, 0, e.tokenStart);
  return (
    D$1(e, t, 1074790415),
    e.finishNode(
      {
        type: "JSXSpreadChild",
        expression: i,
      },
      r,
    )
  );
}
function _r(e, t) {
  return e.finishNode({ type: "JSXEmptyExpression" }, t, e.tokenStart);
}
function vr(e, t) {
  const n = e.tokenStart;
  e.getToken() & 143360 || e.report(30, w$1[e.getToken() & 255]);
  const { tokenValue: r } = e;
  return (
    A$1(e, t),
    e.finishNode(
      {
        type: "JSXIdentifier",
        name: r,
      },
      n,
    )
  );
}
var yr = "6.1.4";
function br(e, t) {
  return ht(e, t);
}
function xr(e, t) {
  return ht(e, t, 3);
}
function Sr(e, t) {
  return ht(e, t);
}
var Cr = ((e, t) => {
  function n(e, t) {
    if (Array.isArray(t))
      return Array.isArray(e)
        ? t.length === e.length && t.every((t, r) => n(e[r], t))
        : !1;
    if (typeof t === "object") {
      if (!e) return !t;
      if ("or" in t) return t.or.some((t) => n(e, t));
      if ("anykey" in t && Array.isArray(t.anykey)) {
        const r = Array.isArray(e) ? e : Object.values(e);
        return t.anykey.every((e) => r.some((t) => n(t, e)));
      }
      for (const [r, i] of Object.entries(t)) if (!n(e[r], i)) return !1;
      return !0;
    }
    return t === e;
  }
  function r(t) {
    return e.parse(t).body[0].expression;
  }
  const i = {
      or: [
        {
          type: "ExpressionStatement",
          expression: {
            type: "AssignmentExpression",
            operator: "=",
            left: {
              or: [{ type: "Identifier" }, { type: "MemberExpression" }],
            },
            right: {
              type: "FunctionExpression",
              async: !1,
            },
          },
        },
        {
          type: "FunctionDeclaration",
          async: !1,
          id: { type: "Identifier" },
        },
        {
          type: "VariableDeclaration",
          declarations: {
            anykey: [
              {
                type: "VariableDeclarator",
                init: {
                  type: "FunctionExpression",
                  async: !1,
                },
              },
            ],
          },
        },
      ],
    },
    a = {
      type: "ExpressionStatement",
      expression: {
        type: "CallExpression",
        callee: {
          type: "MemberExpression",
          object: { type: "Identifier" },
          property: {},
          optional: !1,
        },
        arguments: [
          {
            type: "Literal",
            value: "alr",
          },
          {
            type: "Literal",
            value: "yes",
          },
        ],
        optional: !1,
      },
    };
  function o(e) {
    if (!n(e, i)) return null;
    const t = [];
    if (e.type === "FunctionDeclaration") {
      const n = e.body?.body;
      e.id &&
        n &&
        t.push({
          name: e.id,
          statements: n,
        });
    } else if (e.type === "ExpressionStatement") {
      if (e.expression.type !== "AssignmentExpression") return null;
      const n = e.expression.left,
        r = e.expression.right?.body?.body;
      n &&
        r &&
        t.push({
          name: n,
          statements: r,
        });
    } else if (e.type === "VariableDeclaration")
      for (const n of e.declarations) {
        const e = n.id,
          r = n.init?.body?.body;
        e &&
          r &&
          t.push({
            name: e,
            statements: r,
          });
      }
    for (const { name: e, statements: r } of t)
      if (n(r, { anykey: [a] })) return s(e);
    return null;
  }
  function s(e) {
    return r(`
({sig, n}) => {
  const url = (${t.generate(e)})("https://youtube.com/watch?v=yt-dlp-wins", "s", sig ? encodeURIComponent(sig) : undefined);
  url.set("n", n);
  const proto = Object.getPrototypeOf(url);
  const keys = Object.keys(proto).concat(Object.getOwnPropertyNames(proto));
  for (const key of keys) {
    if (!["constructor", "set", "get", "clone"].includes(key)) {
      url[key]();
      break;
    }
  }
  const s = url.get("s");
  return {
    sig: s ? decodeURIComponent(s) : null,
    n: url.get("n") ?? null,
  };
}
`);
  }
  function c(n) {
    const r = e.parse(n),
      i = l(r),
      a = u(i);
    for (const [e, t] of Object.entries(a))
      i.push({
        type: "ExpressionStatement",
        expression: {
          type: "AssignmentExpression",
          operator: "=",
          left: {
            type: "MemberExpression",
            computed: !1,
            object: {
              type: "Identifier",
              name: "_result",
            },
            property: {
              type: "Identifier",
              name: e,
            },
            optional: !1,
          },
          right: f(t),
        },
      });
    return t.generate(r);
  }
  function l(e) {
    const t = e.body,
      n = (() => {
        switch (t.length) {
          case 1: {
            const e = t[0];
            if (
              e?.type === "ExpressionStatement" &&
              e.expression.type === "CallExpression" &&
              e.expression.callee.type === "MemberExpression" &&
              e.expression.callee.object.type === "FunctionExpression"
            )
              return e.expression.callee.object.body;
            break;
          }
          case 2: {
            const e = t[1];
            if (
              e?.type === "ExpressionStatement" &&
              e.expression.type === "CallExpression" &&
              e.expression.callee.type === "FunctionExpression"
            ) {
              const t = e.expression.callee.body;
              return t.body.splice(0, 1), t;
            }
            break;
          }
        }
        throw Error("Unexpected YouTube player structure");
      })();
    return (
      (n.body = n.body.filter(
        (e) =>
          e.type !== "ExpressionStatement" ||
          e.expression.type === "AssignmentExpression" ||
          e.expression.type === "Literal",
      )),
      n.body
    );
  }
  function u(e) {
    const t = {
      n: [],
      sig: [],
    };
    for (const n of e) {
      const e = o(n);
      e &&
        (t.n.push(
          d(e, {
            type: "Identifier",
            name: "n",
          }),
        ),
        t.sig.push(
          d(e, {
            type: "Identifier",
            name: "sig",
          }),
        ));
    }
    return t;
  }
  function d(e, t) {
    return {
      type: "ArrowFunctionExpression",
      params: [t],
      body: {
        type: "MemberExpression",
        object: {
          type: "CallExpression",
          callee: e,
          arguments: [
            {
              type: "ObjectExpression",
              properties: [
                {
                  type: "Property",
                  key: t,
                  value: t,
                  kind: "init",
                  computed: !1,
                  method: !1,
                  shorthand: !0,
                },
              ],
            },
          ],
          optional: !1,
        },
        computed: !1,
        property: t,
        optional: !1,
      },
      async: !1,
      expression: !0,
      generator: !1,
    };
  }
  function f(e) {
    return r(`
(_input) => {
  const _results = new Set();
  const errors = [];
  for (const _generator of ${t.generate({
    type: "ArrayExpression",
    elements: e,
  })}) {
    try {
      _results.add(_generator(_input));
    } catch (error) {
      errors.push(error);
    }
  }
  if (!_results.size) {
    throw new Error(\`no solutions: \${errors.join(", ")}\`);
  }
  if (_results.size !== 1) {
    throw new Error(\`invalid solutions: \${[..._results].map((value) => JSON.stringify(value)).join(", ")}\`);
  }
  return _results.values().next().value;
}
`);
  }
  return c;
})(se, n$1);

export const prepareYouTubePlayer = Cr;
