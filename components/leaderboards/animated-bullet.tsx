const EMBERS = Array.from({ length: 14 }, (_, index) => index + 1);
const TRACERS = [1, 2, 3];

export function AnimatedBullet() {
  return (
    <div className="dzn-bullet-wrap" aria-hidden="true">
      <div className="dzn-bullet-stage">
        <div className="dzn-bullet-smoke" />
        <div className="dzn-bullet-tracer-wrap">
          {TRACERS.map((item) => (
            <span key={item} className={`dzn-bullet-tracer dzn-bullet-tracer--${item}`} />
          ))}
        </div>
        <div className="dzn-bullet-glow" />
        {EMBERS.map((item) => (
          <span key={item} className={`dzn-ember dzn-ember--${item}`} />
        ))}
        <div className="dzn-bullet-core">
          <span className="dzn-bullet-core__ridge" />
          <span className="dzn-bullet-core__tip" />
        </div>
      </div>
    </div>
  );
}
