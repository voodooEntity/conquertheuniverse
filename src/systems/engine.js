export function createEngine(renderer, scene, camera, controls, systems = []) {
  let raf = 0;
  let last = performance.now();
  let running = false;

  function update() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    for (const s of systems) s.update?.(dt, now / 1000);
    controls.update();
    renderer.render(scene, camera);
    if (running) raf = requestAnimationFrame(update);
  }

  return {
    start() {
      if (running) return;
      running = true; last = performance.now();
      raf = requestAnimationFrame(update);
    },
    stop() {
      running = false; cancelAnimationFrame(raf);
    },
  };
}
