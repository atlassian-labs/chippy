import React, { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react';

function FunctionInvokePanel() {
  const [happyCount, setHappyCount] = useState(0);
  const [asyncCount, setAsyncCount] = useState(0);
  const [lastAction, setLastAction] = useState('none');

  const onHappy = useCallback(() => {
    setHappyCount((n) => n + 1);
    setLastAction('happy');
    return 'happy-ok';
  }, []);

  const onThrow = useCallback(() => {
    setLastAction('throw-before-error');
    throw new Error('manual-fixture-boom');
  }, []);

  const onAsync = useCallback(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
    setAsyncCount((n) => n + 1);
    setLastAction('async');
    return { asyncOk: true, value: asyncCount + 1 };
  }, [asyncCount]);

  return (
    <section data-testid="fiber-invoke-function-panel">
      <h2>fiber-invoke · function component</h2>
      <p data-testid="manual-fixture-status">
        happy={happyCount} async={asyncCount} last={lastAction}
      </p>
      <button data-testid="manual-on-happy" onClick={onHappy} data-manual-label="non-callable-string">
        happy callback
      </button>
      <button data-testid="manual-on-throw" onClick={onThrow}>
        throwing callback
      </button>
      <button data-testid="manual-on-async" onClick={onAsync}>
        async callback
      </button>
    </section>
  );
}

class ClassInvokeButton extends Component {
  constructor(props) {
    super(props);
    this.state = { count: 0 };
    this.handleClassClick = this.handleClassClick.bind(this);
  }

  handleClassClick(multiplier = 2) {
    const next = this.state.count + multiplier;
    this.setState({ count: next });
    return next;
  }

  render() {
    return (
      <section data-testid="fiber-invoke-class-panel">
        <h2>fiber-invoke · class component</h2>
        <p data-testid="manual-class-status">classCount={this.state.count}</p>
        <button data-testid="manual-on-class" onClick={this.handleClassClick}>
          class callback
        </button>
      </section>
    );
  }
}

function TrasherChild({ payload, onReport }) {
  const [effectHits, setEffectHits] = useState(0);

  // Fresh object + fresh callback from the parent should make this effect fire
  // once after each parent-triggered update. Important: this effect must not
  // update parent state, or the fixture becomes an unbounded feedback loop.
  useEffect(() => {
    setEffectHits((n) => n + 1);
    onReport(payload.id);
  }, [payload, onReport]);

  const expensive = useMemo(() => ({ label: payload.label, doubled: payload.id * 2 }), [payload]);

  return (
    <div data-testid="manual-trasher-child">
      trasher child · effectHits={effectHits} · memo={expensive.label}:{expensive.doubled}
    </div>
  );
}

function TrasherPanel() {
  const [tick, setTick] = useState(0);
  const [reports, setReports] = useState(0);
  const renderCount = useRef(0);
  renderCount.current += 1;

  // Intentional unstable identity. Do not memoize; this is the test fixture.
  const payload = { id: tick, label: 'unstable-payload' };
  const onReport = (id) => id;

  return (
    <section data-testid="rendered-by-commit-panel">
      <h2>renderedByCommit / trasher fixture</h2>
      <p data-testid="manual-trasher-status">
        tick={tick} reports={reports} parentRenders={renderCount.current}
      </p>
      <button
        data-testid="manual-trasher-tick"
        onClick={() => {
          setTick((n) => n + 1);
          setReports((n) => n + 1);
        }}
      >
        trigger trasher
      </button>
      <TrasherChild payload={payload} onReport={onReport} />
    </section>
  );
}


function TogglePanel() {
  const [isEnabled, setEnabled] = useState(false);

  // Intentionally unstable identity: dep [isEnabled] flips every render, so
  // useCallback returns a fresh function every commit. Avalanche should report
  //   propChanges: [
  //     { name: "isEnabled", kind: "scalar-changed", prev, current },
  //     { name: "toggle",    kind: "ref-changed",    prev, current },
  //   ]
  // on the Target child for every commit triggered by clicking the toggle.
  const toggle = useCallback(() => setEnabled(!isEnabled), [isEnabled]);

  return (
    <section data-testid="toggle-panel">
      <h2>WDYR — toggle callback fixture</h2>
      <p data-testid="manual-toggle-status">isEnabled={String(isEnabled)}</p>
      <button data-testid="manual-toggle-tick" onClick={toggle}>
        toggle
      </button>
      <Target isEnabled={isEnabled} toggle={toggle} />
    </section>
  );
}

function Target({ isEnabled, toggle }) {
  return (
    <div data-testid="manual-toggle-target">
      target · isEnabled={String(isEnabled)} · toggleIsFunction={String(typeof toggle === 'function')}
    </div>
  );
}


function ArrayPropPanel() {
  const [tick, setTick] = useState(0);

  // Avoidable update: items is a brand-new array literal every render.
  // Child receives a "ref-changed" prop even though contents are equal.
  // Stable version would be `useMemo(() => [1, 2, 3], [])` or hoisted constant.
  const items = [1, 2, 3];

  return (
    <section data-testid="array-prop-panel">
      <h2>Avoidable update — array literal as prop</h2>
      <p data-testid="manual-array-status">tick={tick}</p>
      <button data-testid="manual-array-tick" onClick={() => setTick((n) => n + 1)}>
        bump parent
      </button>
      <Child items={items} />
    </section>
  );
}

const Child = React.memo(function Child({ items }) {
  return (
    <div data-testid="manual-array-child">
      child · items=[{items.join(',')}] · length={items.length}
    </div>
  );
});


const ChildA = React.memo(function ChildA() {
  return <span data-testid="manual-children-child-a">child-A</span>;
});

const ChildB = React.memo(function ChildB() {
  return <span data-testid="manual-children-child-b">child-B</span>;
});

const MemoizedParent = React.memo(function MemoizedParent({ children }) {
  return (
    <div data-testid="manual-children-parent">
      parent · {children}
    </div>
  );
});

function ChildrenPropPanel() {
  const [tick, setTick] = useState(0);

  // Caller renders <ChildA/> and <ChildB/> inline. JSX creates a fresh
  // ReactElement array for `children` on every parent render, so
  // React.memo(MemoizedParent) cannot shallow-compare children equal —
  // even though the elements are structurally identical.
  // Avalanche should report propChanges:
  //   [{ name: "children", kind: "ref-changed", prev, current }]
  // on MemoizedParent every commit triggered by `bump caller`.
  // The unavoidable fix layer is hoisting <ChildA/> and <ChildB/> into a
  // stable variable (or passing them as a memoized array).
  return (
    <section data-testid="children-prop-panel">
      <h2>Avoidable update — JSX children pass-through</h2>
      <p data-testid="manual-children-status">tick={tick}</p>
      <button data-testid="manual-children-tick" onClick={() => setTick((n) => n + 1)}>
        bump caller
      </button>
      <MemoizedParent>
        <ChildA />
        <ChildB />
      </MemoizedParent>
    </section>
  );
}

export default function ManualExtensionVerification() {
  return (
    <main data-testid="manual-extension-verification">
      <h1>Chippy manual extension verification</h1>
      <p>
        Fixture for extension-path verification of fiber-invoke, async/throwing callbacks,
        class-component this binding, Avalanche renderedByCommit / trasherCounts evidence,
        and WDYR-style propChanges on a toggle callback.
      </p>
      <FunctionInvokePanel />
      <ClassInvokeButton />
      <TrasherPanel />
      <TogglePanel />
      <ArrayPropPanel />
      <ChildrenPropPanel />
    </main>
  );
}
