"use client";

import Image from "next/image";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { useEffect } from "react";

const particles = Array.from({ length: 52 }, (_, index) => ({
  id: `particle-${index}`,
  left: `${(index * 37) % 100}%`,
  top: `${(index * 19) % 100}%`,
  size: 1 + (index % 4),
  delay: `${(index % 13) * 0.45}s`,
  duration: `${11 + (index % 9)}s`,
  opacity: 0.18 + (index % 5) * 0.07,
}));

const embers = Array.from({ length: 24 }, (_, index) => ({
  id: `ember-${index}`,
  left: `${(index * 29 + 8) % 100}%`,
  bottom: `${(index * 17) % 45}%`,
  size: 2 + (index % 3),
  delay: `${(index % 8) * 0.7}s`,
  duration: `${9 + (index % 7)}s`,
}));

const dust = Array.from({ length: 36 }, (_, index) => ({
  id: `dust-${index}`,
  left: `${(index * 43 + 11) % 100}%`,
  top: `${(index * 23 + 5) % 100}%`,
  delay: `${(index % 12) * 0.4}s`,
  duration: `${15 + (index % 10)}s`,
}));

export function AnimatedBackground() {
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const smoothX = useSpring(mouseX, { stiffness: 35, damping: 22, mass: 0.6 });
  const smoothY = useSpring(mouseY, { stiffness: 35, damping: 22, mass: 0.6 });
  const bgX = useTransform(smoothX, [-1, 1], [18, -18]);
  const bgY = useTransform(smoothY, [-1, 1], [10, -10]);
  const fogX = useTransform(smoothX, [-1, 1], [-24, 24]);
  const fogY = useTransform(smoothY, [-1, 1], [-14, 14]);
  const lightX = useTransform(smoothX, [-1, 1], [-42, 42]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const nextX = event.clientX / window.innerWidth - 0.5;
      const nextY = event.clientY / window.innerHeight - 0.5;
      mouseX.set(nextX * 2);
      mouseY.set(nextY * 2);
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    return () => window.removeEventListener("pointermove", handlePointerMove);
  }, [mouseX, mouseY]);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#02030a]"
    >
      <motion.div
        className="absolute -inset-8 will-change-transform"
        style={{ x: bgX, y: bgY }}
      >
        <Image
          src="/media/dzn-cinematic-survivor.png"
          alt=""
          fill
          priority
          sizes="100vw"
          className="dzn-hero-image object-cover opacity-[0.72]"
        />
      </motion.div>

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_68%_20%,rgba(139,92,246,0.24),transparent_28%),radial-gradient(circle_at_28%_72%,rgba(14,165,233,0.16),transparent_30%),linear-gradient(90deg,rgba(2,3,10,0.92)_0%,rgba(2,4,12,0.48)_44%,rgba(2,3,10,0.82)_100%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,3,10,0.22)_0%,rgba(2,3,10,0.2)_45%,rgba(2,3,10,0.95)_100%)]" />
      <div className="scanline absolute inset-0 opacity-25" />

      <motion.div className="fog-layer fog-layer-one" style={{ x: fogX, y: fogY }} />
      <motion.div className="fog-layer fog-layer-two" style={{ x: fogY, y: fogX }} />
      <motion.div className="fog-layer fog-layer-three" style={{ x: fogX }} />

      <motion.div className="absolute inset-0" style={{ x: lightX }}>
        <span className="light-ray left-[8%] top-[-16%]" />
        <span className="light-ray left-[46%] top-[-22%] animation-delay-2" />
        <span className="light-ray right-[4%] top-[-18%] animation-delay-4" />
      </motion.div>

      <div className="ambient-orb left-[8%] top-[18%]" />
      <div className="ambient-orb ambient-orb-violet right-[16%] top-[20%]" />
      <div className="ambient-orb ambient-orb-cyan bottom-[8%] left-[42%]" />

      <div className="absolute inset-0">
        {particles.map((particle) => (
          <span
            key={particle.id}
            className="particle"
            style={{
              left: particle.left,
              top: particle.top,
              width: particle.size,
              height: particle.size,
              opacity: particle.opacity,
              animationDelay: particle.delay,
              animationDuration: particle.duration,
            }}
          />
        ))}
      </div>

      <div className="absolute inset-0">
        {dust.map((item) => (
          <span
            key={item.id}
            className="dust"
            style={{
              left: item.left,
              top: item.top,
              animationDelay: item.delay,
              animationDuration: item.duration,
            }}
          />
        ))}
      </div>

      <div className="absolute inset-0">
        {embers.map((ember) => (
          <span
            key={ember.id}
            className="ember"
            style={{
              left: ember.left,
              bottom: ember.bottom,
              width: ember.size,
              height: ember.size,
              animationDelay: ember.delay,
              animationDuration: ember.duration,
            }}
          />
        ))}
      </div>
    </div>
  );
}
