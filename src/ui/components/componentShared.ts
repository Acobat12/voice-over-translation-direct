import type { EventImpl } from "../../core/eventImpl";

type EventHandler<Args extends unknown[]> = (...args: Args) => void;

export function addComponentEventListener<
  T extends string,
  Args extends unknown[],
>(
  events: Record<T, EventImpl<Args>>,
  type: T,
  listener: EventHandler<Args>,
): void {
  events[type].addListener(listener);
}

export function removeComponentEventListener<
  T extends string,
  Args extends unknown[],
>(
  events: Record<T, EventImpl<Args>>,
  type: T,
  listener: EventHandler<Args>,
): void {
  events[type].removeListener(listener);
}

export function setHiddenState(
  element: {
    hidden: boolean | string;
  },
  isHidden: boolean,
): void {
  element.hidden = isHidden;
}

export function getHiddenState(element: { hidden: boolean | string }): boolean {
  return Boolean(element.hidden);
}
