export class StaticRenderable {
  readonly factory: () => Node;

  constructor(factory: () => Node) {
    this.factory = factory;
  }

  clone(): Node {
    return this.factory();
  }
}

export type Renderable =
  | string
  | number
  | Node
  | StaticRenderable
  | readonly Renderable[]
  | null
  | undefined
  | false;

export function createStaticRenderable(factory: () => Node): StaticRenderable {
  return new StaticRenderable(factory);
}

export function appendRenderable(target: Node, value: Renderable): void {
  if (value == null || value === false) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      appendRenderable(target, item);
    }
    return;
  }

  if (value instanceof StaticRenderable) {
    target.appendChild(value.clone());
    return;
  }

  if (value instanceof Node) {
    target.appendChild(value);
    return;
  }

  target.appendChild(document.createTextNode(String(value)));
}

export function createRenderableFragment(
  ...values: readonly Renderable[]
): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const value of values) {
    appendRenderable(fragment, value);
  }
  return fragment;
}

export function renderRenderable(value: Renderable, target: Element): void {
  target.replaceChildren();
  appendRenderable(target, value);
}
