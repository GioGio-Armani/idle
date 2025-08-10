"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type SaveState = {
  gold: number;
  level: number;
  tapDamage: number; // damage per tap
  passiveIncome: number; // gold per second
  monsterMaxHp: number;
  monsterHp: number;
  lastSavedAt: number; // epoch ms
};

const STORAGE_KEY = "idle-clicker-save-v1";

function formatNumber(value: number): string {
  if (value < 1000) return value.toString();
  const units = [
    "",
    "K",
    "M",
    "B",
    "T",
    "Qa",
    "Qi",
    "Sx",
    "Sp",
    "Oc",
    "No",
    "Dc",
  ];
  const tier = Math.floor(Math.log10(value) / 3);
  const scaled = value / Math.pow(10, tier * 3);
  return `${scaled.toFixed(2)}${units[tier]}`;
}

function initialMonsterHpForLevel(level: number): number {
  // Exponential scaling with a gentle curve
  const base = 20;
  return Math.floor(base * Math.pow(1.25, level - 1));
}

function loadSave(): SaveState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SaveState;
    return parsed;
  } catch {
    return null;
  }
}

function save(state: SaveState) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...state, lastSavedAt: Date.now() })
    );
  } catch {}
}

export default function IdleGame() {
  const [gold, setGold] = useState(0);
  const [level, setLevel] = useState(1);
  const [tapDamage, setTapDamage] = useState(1);
  const [passiveIncome, setPassiveIncome] = useState(0);
  const [monsterMaxHp, setMonsterMaxHp] = useState(initialMonsterHpForLevel(1));
  const [monsterHp, setMonsterHp] = useState(monsterMaxHp);
  const [loaded, setLoaded] = useState(false);
  const [slashes, setSlashes] = useState<{ id: number; x: number; y: number; angle: number }[]>([]);

  const lastTickRef = useRef<number>(Date.now());

  // Derived values
  const nextTapUpgradeCost = useMemo(
    () => Math.ceil(10 * Math.pow(1.35, tapDamage - 1)),
    [tapDamage]
  );
  const nextPassiveUpgradeCost = useMemo(
    () => Math.ceil(25 * Math.pow(1.32, passiveIncome)),
    [passiveIncome]
  );

  const monsterHpPct = useMemo(() => {
    return Math.max(0, Math.min(100, (monsterHp / monsterMaxHp) * 100));
  }, [monsterHp, monsterMaxHp]);

  // Load save + offline progress
  useEffect(() => {
    const saved = loadSave();
    if (saved) {
      const now = Date.now();
      const elapsedSec = Math.max(
        0,
        Math.floor((now - (saved.lastSavedAt ?? now)) / 1000)
      );
      const offlineGold = elapsedSec * saved.passiveIncome;
      setGold(saved.gold + offlineGold);
      setLevel(saved.level);
      setTapDamage(saved.tapDamage);
      setPassiveIncome(saved.passiveIncome);
      setMonsterMaxHp(saved.monsterMaxHp);
      setMonsterHp(saved.monsterHp);
      lastTickRef.current = now;
    } else {
      // Fresh game
      const hp = initialMonsterHpForLevel(1);
      setMonsterMaxHp(hp);
      setMonsterHp(hp);
      lastTickRef.current = Date.now();
    }
    setLoaded(true);
  }, []);

  // Passive income tick (1s)
  useEffect(() => {
    const id = setInterval(() => {
      setGold((g) => g + passiveIncome);
      lastTickRef.current = Date.now();
    }, 1000);
    return () => clearInterval(id);
  }, [passiveIncome]);

  // Autosave every 3s
  useEffect(() => {
    if (!loaded) return;
    const id = setInterval(() => {
      save({
        gold,
        level,
        tapDamage,
        passiveIncome,
        monsterMaxHp,
        monsterHp,
        lastSavedAt: Date.now(),
      });
    }, 3000);
    return () => clearInterval(id);
  }, [loaded, gold, level, tapDamage, passiveIncome, monsterMaxHp, monsterHp]);

  const nextLevel = useCallback(() => {
    const newLevel = level + 1;
    const hp = initialMonsterHpForLevel(newLevel);
    setLevel(newLevel);
    setMonsterMaxHp(hp);
    setMonsterHp(hp);
  }, [level]);

  const handleAttack = useCallback((e?: React.MouseEvent | React.TouchEvent) => {
    // Slash animation at click/touch point
    const container = containerRef.current;
    if (container && e) {
      const rect = container.getBoundingClientRect();
      const clientX = "touches" in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
      const clientY = "touches" in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const angle = -25 + Math.random() * 50;
      const id = Date.now() + Math.random();
      setSlashes((s) => [...s, { id, x, y, angle }]);
      setTimeout(() => {
        setSlashes((s) => s.filter((it) => it.id !== id));
      }, 360);
    }

    setMonsterHp((hp) => {
      const nextHp = Math.max(0, hp - tapDamage);
      if (nextHp <= 0) {
        // Reward: gold equal to 5% of monster max HP (rounded)
        setGold((g) => g + Math.max(1, Math.floor(monsterMaxHp * 0.05)));
        // Chance to drop a small bonus
        if (Math.random() < 0.05) setGold((g) => g + 25);
        // Advance level
        setTimeout(nextLevel, 0);
        return 0;
      }
      return nextHp;
    });
  }, [tapDamage, monsterMaxHp, nextLevel]);

  const buyTapUpgrade = useCallback(() => {
    if (gold < nextTapUpgradeCost) return;
    setGold((g) => g - nextTapUpgradeCost);
    setTapDamage((d) => d + 1);
  }, [gold, nextTapUpgradeCost]);

  const buyPassiveUpgrade = useCallback(() => {
    if (gold < nextPassiveUpgradeCost) return;
    setGold((g) => g - nextPassiveUpgradeCost);
    setPassiveIncome((p) => p + 1);
  }, [gold, nextPassiveUpgradeCost]);

  const handleHardReset = useCallback(() => {
    const hp = initialMonsterHpForLevel(1);
    setGold(0);
    setLevel(1);
    setTapDamage(1);
    setPassiveIncome(0);
    setMonsterMaxHp(hp);
    setMonsterHp(hp);
    save({
      gold: 0,
      level: 1,
      tapDamage: 1,
      passiveIncome: 0,
      monsterMaxHp: hp,
      monsterHp: hp,
      lastSavedAt: Date.now(),
    });
  }, []);

  // Save when unloading
  useEffect(() => {
    const onBeforeUnload = () => {
      save({
        gold,
        level,
        tapDamage,
        passiveIncome,
        monsterMaxHp,
        monsterHp,
        lastSavedAt: Date.now(),
      });
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [gold, level, tapDamage, passiveIncome, monsterMaxHp, monsterHp]);

  const containerRef = useRef<HTMLDivElement | null>(null);

  // Level-gated upgrade requirements
  const canBuyBlade = level >= 1;
  const canBuyMiners = level >= 3;
  const canBuyArcaneForge = level >= 5;

  return (
    <div ref={containerRef} className="with-aurora min-h-screen w-full flex flex-col items-center justify-between p-4 sm:p-6 text-foreground bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-950 via-slate-950 to-black">
      {/* Header */}
      <header className="w-full max-w-md flex items-center justify-between">
        <div>
          <h1 className="font-fantasy title-glow text-3xl sm:text-4xl text-indigo-200 tracking-wide">
            Arcane Clicker
          </h1>
          <p className="text-xs text-indigo-300/80">Level {level}</p>
        </div>
        <button
          onClick={handleHardReset}
          className="text-[10px] uppercase tracking-widest text-rose-300/70 hover:text-rose-200"
        >
          Reset
        </button>
      </header>

      {/* Stats */}
      <section className="w-full max-w-md mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-slate-900/50 ring-1 ring-white/10 p-2">
          <div className="text-[10px] text-indigo-300/80">Gold</div>
          <div className="text-lg font-semibold text-amber-300">
            {formatNumber(gold)}
          </div>
        </div>
        <div className="rounded-lg bg-slate-900/50 ring-1 ring-white/10 p-2">
          <div className="text-[10px] text-indigo-300/80">Tap DMG</div>
          <div className="text-lg font-semibold text-indigo-200">
            {formatNumber(tapDamage)}
          </div>
        </div>
        <div className="rounded-lg bg-slate-900/50 ring-1 ring-white/10 p-2">
          <div className="text-[10px] text-indigo-300/80">Gold/s</div>
          <div className="text-lg font-semibold text-emerald-300">
            {formatNumber(passiveIncome)}
          </div>
        </div>
      </section>

      {/* Monster card */}
      <section className="w-full max-w-md mt-6">
        <div className="relative rounded-2xl p-4 sm:p-6 overflow-hidden cursor-pointer select-none bg-gradient-to-b from-indigo-800/60 to-slate-900/70 ring-1 ring-white/10 shadow-[0_0_40px_rgba(99,102,241,0.25)]">
          <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(closest-side,_rgba(99,102,241,0.25),transparent)]" />
          <div className="flex items-center justify-between mb-2">
            <div className="font-fantasy text-indigo-200">Eldritch Wisp</div>
            <div className="text-xs text-indigo-300/80">
              {formatNumber(monsterHp)} / {formatNumber(monsterMaxHp)} HP
            </div>
          </div>
          <div className="h-3 w-full rounded-full bg-slate-800/80 ring-1 ring-white/10 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-rose-400 to-rose-600 transition-[width] duration-200"
              style={{ width: `${monsterHpPct}%` }}
            />
          </div>
          <div
            onClick={(e) => handleAttack(e)}
            onTouchStart={(e) => handleAttack(e)}
            className="mt-4 aspect-[16/10] sm:aspect-[16/8] rounded-xl border border-white/10 bg-[radial-gradient(circle_at_50%_40%,rgba(255,255,255,0.06),transparent_60%)] flex items-center justify-center active:scale-[0.99] transition-transform relative"
          >
            {/* CSS Monster */}
            <div className="relative w-40 sm:w-48 aspect-square">
              <div className="absolute inset-0 rounded-full bg-gradient-to-b from-slate-300 to-slate-600 ring-1 ring-white/20 shadow-2xl" />
              {/* eyes */}
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-16">
                <div className="absolute left-0 top-0 w-8 h-8 bg-black/80 rounded-full shadow-inner" />
                <div className="absolute right-0 top-0 w-8 h-8 bg-black/80 rounded-full shadow-inner" />
                <div className="absolute left-2 top-2 w-4 h-4 bg-white/90 rounded-full animate-pulse" />
                <div className="absolute right-2 top-2 w-4 h-4 bg-white/90 rounded-full animate-pulse" />
              </div>
              {/* mouth */}
              <div className="absolute left-1/2 bottom-8 -translate-x-1/2 w-20 h-4 bg-black/70 rounded-b-full" />
              {/* horns */}
              <div className="absolute -top-2 left-4 w-8 h-8 rotate-[-25deg] border-l-8 border-b-8 border-transparent border-l-rose-400/70 border-b-rose-400/70" />
              <div className="absolute -top-2 right-4 w-8 h-8 rotate-[25deg] border-r-8 border-b-8 border-transparent border-r-rose-400/70 border-b-rose-400/70" />
            </div>

            {/* Slashes */}
            {slashes.map((s) => (
              <div
                key={s.id}
                className="slash"
                style={{
                  left: s.x,
                  top: s.y,
                  transformOrigin: "center",
                  // provide CSS vars for keyframes
                  // @ts-expect-error custom properties
                  "--angle": `${s.angle}deg`,
                  // @ts-expect-error custom properties
                  "--sx": `${Math.cos((s.angle * Math.PI) / 180) * -14}px`,
                  // @ts-expect-error custom properties
                  "--sy": `${Math.sin((s.angle * Math.PI) / 180) * 14}px`,
                }}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Upgrades (level gated) */}
      <section className="w-full max-w-md mt-6 mb-4 grid grid-cols-2 gap-3">
        <button
          onClick={buyTapUpgrade}
          disabled={!canBuyBlade || gold < nextTapUpgradeCost}
          className="rounded-xl p-3 text-left bg-slate-900/60 ring-1 ring-white/10 hover:ring-indigo-400/40 hover:bg-slate-900/70 disabled:opacity-50 disabled:saturate-50"
        >
          <div className="text-sm font-fantasy text-indigo-200">
            Runic Blade
          </div>
          <div className="text-[11px] text-indigo-300/80">+1 DMG per tap</div>
          <div className="mt-1 text-amber-300 text-sm">Cost: {formatNumber(nextTapUpgradeCost)} gold</div>
          {!canBuyBlade && (
            <div className="mt-1 text-[10px] text-rose-300/70">Unlocks at Lv 1</div>
          )}
        </button>

        <button
          onClick={buyPassiveUpgrade}
          disabled={!canBuyMiners || gold < nextPassiveUpgradeCost}
          className="rounded-xl p-3 text-left bg-slate-900/60 ring-1 ring-white/10 hover:ring-indigo-400/40 hover:bg-slate-900/70 disabled:opacity-50 disabled:saturate-50"
        >
          <div className="text-sm font-fantasy text-indigo-200">
            Mystic Miners
          </div>
          <div className="text-[11px] text-indigo-300/80">+1 gold / sec</div>
          <div className="mt-1 text-amber-300 text-sm">Cost: {formatNumber(nextPassiveUpgradeCost)} gold</div>
          {!canBuyMiners && (
            <div className="mt-1 text-[10px] text-rose-300/70">Unlocks at Lv 3</div>
          )}
        </button>

        {/* Example third gated upgrade (unlocks at Lv 5) */}
        <button
          onClick={() => {
            if (!canBuyArcaneForge || gold < 100) return;
            setGold((g) => g - 100);
            setTapDamage((d) => d + 3);
          }}
          disabled={!canBuyArcaneForge || gold < 100}
          className="rounded-xl p-3 text-left bg-slate-900/60 ring-1 ring-white/10 hover:ring-indigo-400/40 hover:bg-slate-900/70 disabled:opacity-50 disabled:saturate-50"
        >
          <div className="text-sm font-fantasy text-indigo-200">Arcane Forge</div>
          <div className="text-[11px] text-indigo-300/80">+3 DMG per tap</div>
          <div className="mt-1 text-amber-300 text-sm">Cost: 100 gold</div>
          {!canBuyArcaneForge && (
            <div className="mt-1 text-[10px] text-rose-300/70">Unlocks at Lv 5</div>
          )}
        </button>
      </section>

      {/* Footer hint */}
      <footer className="w-full max-w-md pb-1 text-center text-[10px] text-indigo-300/60">
        Progress is saved locally. Offline gold accrues while away.
      </footer>
    </div>
  );
}
