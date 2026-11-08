// jsdom 은 IntersectionObserver 미구현. 교차는 테스트가 직접 발생.
const observers = new Set<StubObserver>()

class StubObserver {
  private readonly targets = new Set<Element>()

  constructor(private readonly callback: IntersectionObserverCallback) {}

  observe(target: Element): void {
    this.targets.add(target)
    observers.add(this)
  }

  unobserve(target: Element): void {
    this.targets.delete(target)
  }

  disconnect(): void {
    this.targets.clear()
    observers.delete(this)
  }

  takeRecords(): IntersectionObserverEntry[] {
    return []
  }

  fire(): void {
    const entries = [...this.targets].map(
      (target) =>
        ({ target, isIntersecting: true }) as IntersectionObserverEntry,
    )
    this.callback(entries, this as unknown as IntersectionObserver)
  }
}

export function installIntersectionObserver(): void {
  window.IntersectionObserver =
    StubObserver as unknown as typeof IntersectionObserver
}

// 관찰 중인 모든 대상이 화면에 들어온 것으로 통지.
export function intersectAll(): void {
  for (const o of [...observers]) o.fire()
}
