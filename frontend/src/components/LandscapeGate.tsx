import { useEffect, useState, type ReactNode } from 'react';

interface LandscapeGateProps {
  children: ReactNode;
}

const shouldGate = () =>
  window.innerWidth < 960 && window.innerHeight > window.innerWidth;

export const LandscapeGate = ({ children }: LandscapeGateProps) => {
  const [gated, setGated] = useState(false);

  useEffect(() => {
    const update = () => setGated(shouldGate());
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  if (gated) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-felt-950 px-6 text-center text-white">
        <div className="text-5xl">📱</div>
        <h1 className="text-2xl font-semibold">Rotate to landscape to play</h1>
        <p className="max-w-md text-sm text-slate-300">
          The craps table is designed for landscape play on phones and small tablets.
        </p>
      </div>
    );
  }

  return <>{children}</>;
};
