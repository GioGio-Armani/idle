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
  mana: number;
  manaMax: number;
  mercenariesLevel: number;
  familiars: {
    sprite: { level: number; unlocked: boolean };
    golem: { level: number; unlocked: boolean };
    dragon: { level: number; unlocked: boolean };
  };
  spells: {
    arcaneBurstEndAt: number;
    arcaneBurstCdEndAt: number;
    timeWarpEndAt: number;
    timeWarpCdEndAt: number;
    armorBreakCdEndAt: number;
  };
};

const STORAGE_KEY = "idle-clicker-save-v1";

type SlashStyle = React.CSSProperties & {
  "--angle"?: string;
  "--sx"?: string;
  "--sy"?: string;
};

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
  const [slashes, setSlashes] = useState<
    { id: number; x: number; y: number; angle: number }[]
  >([]);
  const [mana, setMana] = useState(0);
  const [manaMax, setManaMax] = useState(100);
  const [mercenariesLevel, setMercenariesLevel] = useState(0);
  const [familiars, setFamiliars] = useState({
    sprite: { level: 0, unlocked: false },
    golem: { level: 0, unlocked: false },
    dragon: { level: 0, unlocked: false },
  });
  const [spells, setSpells] = useState({
    arcaneBurstEndAt: 0,
    arcaneBurstCdEndAt: 0,
    timeWarpEndAt: 0,
    timeWarpCdEndAt: 0,
    armorBreakCdEndAt: 0,
  });
  const [bossDeadlineAt, setBossDeadlineAt] = useState<number | null>(null);
  const [damagePops, setDamagePops] = useState<
    { id: number; x: number; y: number; value: number; crit: boolean }[]
  >([]);
  const [sparks, setSparks] = useState<
    { id: number; x: number; y: number; color: string }[]
  >([]);
  const [shakeKey, setShakeKey] = useState(0);

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

  // Zones & modifiers
  const currentZone = useMemo(() => {
    if (level <= 20) {
      return {
        name: "Forêt des murmures",
        spellCdMultiplier: 0.8, // -20% CD
        hpMultiplier: 1,
        goldMultiplier: 1,
      } as const;
    }
    if (level <= 40) {
      return {
        name: "Cryptes maudites",
        spellCdMultiplier: 1,
        hpMultiplier: 1.25, // +25% HP
        goldMultiplier: 1.3, // +30% gold
      } as const;
    }
    return {
      name: "Terres anciennes",
      spellCdMultiplier: 1,
      hpMultiplier: 1,
      goldMultiplier: 1,
    } as const;
  }, [level]);

  const isBossLevel = level % 5 === 0;

  // Crit mechanics (base 5% x2, dragon adds +2% per level)
  const critChance = useMemo(
    () => 0.05 + (familiars.dragon.level || 0) * 0.02,
    [familiars.dragon.level]
  );
  const critMultiplier = 2;

  // Tap multiplier when Arcane Burst active
  const tapMultiplier = useMemo(
    () => (Date.now() < spells.arcaneBurstEndAt ? 3 : 1),
    [spells.arcaneBurstEndAt]
  );
  // Gold/s multiplier when Time Warp active
  const goldPerSecMultiplier = useMemo(
    () =>
      (Date.now() < spells.timeWarpEndAt ? 2 : 1) * currentZone.goldMultiplier,
    [spells.timeWarpEndAt, currentZone.goldMultiplier]
  );

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
      setMana(Math.min(saved.mana ?? 0, saved.manaMax ?? 100));
      setManaMax(saved.manaMax ?? 100);
      setMercenariesLevel(saved.mercenariesLevel ?? 0);
      setFamiliars(
        saved.familiars ?? {
          sprite: { level: 0, unlocked: saved.level >= 5 },
          golem: { level: 0, unlocked: saved.level >= 20 },
          dragon: { level: 0, unlocked: saved.level >= 60 },
        }
      );
      setSpells(
        saved.spells ?? {
          arcaneBurstEndAt: 0,
          arcaneBurstCdEndAt: 0,
          timeWarpEndAt: 0,
          timeWarpCdEndAt: 0,
          armorBreakCdEndAt: 0,
        }
      );
      lastTickRef.current = now;
    } else {
      // Fresh game
      const hp = initialMonsterHpForLevel(1);
      setMonsterMaxHp(hp);
      setMonsterHp(hp);
      setMana(50);
      setManaMax(100);
      lastTickRef.current = Date.now();
    }
    setLoaded(true);
  }, []);

  // Level up handler (declared early so it can be used below)
  const nextLevel = useCallback(() => {
    const newLevel = level + 1;
    const baseHp = initialMonsterHpForLevel(newLevel);
    const hp = Math.floor(baseHp * currentZone.hpMultiplier);
    setLevel(newLevel);
    setMonsterMaxHp(hp);
    setMonsterHp(hp);
    setFamiliars((f) => ({
      sprite: { ...f.sprite, unlocked: f.sprite.unlocked || newLevel >= 5 },
      golem: { ...f.golem, unlocked: f.golem.unlocked || newLevel >= 20 },
      dragon: { ...f.dragon, unlocked: f.dragon.unlocked || newLevel >= 60 },
    }));
    if (newLevel % 5 === 0) setBossDeadlineAt(Date.now() + 30000);
    else setBossDeadlineAt(null);
  }, [level, currentZone.hpMultiplier]);

  const applyDamage = useCallback(
    (rawDamage: number) => {
      setMonsterHp((hp) => {
        const nextHp = Math.max(0, hp - rawDamage);
        if (nextHp <= 0) {
          setGold(
            (g) =>
              g +
              Math.max(
                1,
                Math.floor(monsterMaxHp * 0.05 * currentZone.goldMultiplier)
              )
          );
          if (Math.random() < 0.05) setGold((g) => g + 25);
          setTimeout(nextLevel, 0);
          return 0;
        }
        return nextHp;
      });
    },
    [monsterMaxHp, currentZone.goldMultiplier, nextLevel]
  );

  // Passive income tick (1s)
  useEffect(() => {
    const id = setInterval(() => {
      // Passive gold
      setGold((g) => g + Math.floor(passiveIncome * goldPerSecMultiplier));
      // Mana regen (1.5/sec)
      setMana((m) => Math.min(manaMax, m + 1.5));

      // Auto-attacks: familiars + mercenaries
      let autoDamage = 0;
      if (familiars.sprite.unlocked && familiars.sprite.level > 0) {
        autoDamage += Math.max(1, familiars.sprite.level);
      }
      if (familiars.golem.unlocked && familiars.golem.level > 0) {
        if (Math.random() < 0.12) {
          autoDamage += Math.max(
            2,
            familiars.sprite.level * 6 + familiars.golem.level * 2
          );
        }
      }
      if (mercenariesLevel > 0) {
        autoDamage += mercenariesLevel;
      }
      if (autoDamage > 0) {
        // spark visual near monster center (percentage coordinates inside container)
        const id = Date.now() + Math.random();
        const x = 50 + (Math.random() * 16 - 8); // %
        const y = 48 + (Math.random() * 16 - 8); // %
        const color =
          familiars.golem.unlocked && Math.random() < 0.12
            ? "#f87171"
            : "#60a5fa";
        setSparks((s) => [...s, { id, x, y, color }]);
        setTimeout(() => setSparks((s) => s.filter((sp) => sp.id !== id)), 550);
        applyDamage(autoDamage);
      }

      // Boss timer tick
      if (isBossLevel && bossDeadlineAt && Date.now() >= bossDeadlineAt) {
        setMonsterHp(monsterMaxHp);
        setBossDeadlineAt(Date.now() + 30000);
      }

      lastTickRef.current = Date.now();
    }, 1000);
    return () => clearInterval(id);
  }, [
    passiveIncome,
    goldPerSecMultiplier,
    manaMax,
    familiars,
    mercenariesLevel,
    isBossLevel,
    bossDeadlineAt,
    monsterMaxHp,
    applyDamage,
  ]);

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
        mana,
        manaMax,
        mercenariesLevel,
        familiars,
        spells,
      });
    }, 3000);
    return () => clearInterval(id);
  }, [
    loaded,
    gold,
    level,
    tapDamage,
    passiveIncome,
    monsterMaxHp,
    monsterHp,
    mana,
    manaMax,
    mercenariesLevel,
    familiars,
    spells,
  ]);

  const handleAttack = useCallback(
    (e?: React.MouseEvent | React.TouchEvent) => {
      // Slash animation at click/touch point
      const container = containerRef.current;
      if (container && e) {
        const rect = container.getBoundingClientRect();
        const clientX =
          "touches" in e
            ? e.touches[0].clientX
            : (e as React.MouseEvent).clientX;
        const clientY =
          "touches" in e
            ? e.touches[0].clientY
            : (e as React.MouseEvent).clientY;
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        const angle = -25 + Math.random() * 50;
        const id = Date.now() + Math.random();
        setSlashes((s) => [...s, { id, x, y, angle }]);
        setTimeout(() => {
          setSlashes((s) => s.filter((it) => it.id !== id));
        }, 360);
      }
      // Mana gain on tap
      setMana((m) => Math.min(manaMax, m + 1));
      // Crit + burst multipliers
      const base = tapDamage * tapMultiplier;
      const isCrit = Math.random() < critChance;
      const dmg = isCrit ? Math.floor(base * critMultiplier) : base;
      // floating damage text at click point
      if (container && e) {
        const rect = container.getBoundingClientRect();
        const clientX =
          "touches" in e
            ? e.touches[0].clientX
            : (e as React.MouseEvent).clientX;
        const clientY =
          "touches" in e
            ? e.touches[0].clientY
            : (e as React.MouseEvent).clientY;
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        const id = Date.now() + Math.random();
        setDamagePops((arr) => [
          ...arr,
          { id, x, y, value: dmg, crit: isCrit },
        ]);
        setTimeout(
          () => setDamagePops((arr) => arr.filter((p) => p.id !== id)),
          900
        );
      }
      if (isCrit) setShakeKey((k) => k + 1);
      applyDamage(dmg);
    },
    [manaMax, tapDamage, tapMultiplier, critChance, critMultiplier, applyDamage]
  );

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
    setMana(50);
    setManaMax(100);
    setMercenariesLevel(0);
    setFamiliars({
      sprite: { level: 0, unlocked: false },
      golem: { level: 0, unlocked: false },
      dragon: { level: 0, unlocked: false },
    });
    setSpells({
      arcaneBurstEndAt: 0,
      arcaneBurstCdEndAt: 0,
      timeWarpEndAt: 0,
      timeWarpCdEndAt: 0,
      armorBreakCdEndAt: 0,
    });
    setBossDeadlineAt(null);
    save({
      gold: 0,
      level: 1,
      tapDamage: 1,
      passiveIncome: 0,
      monsterMaxHp: hp,
      monsterHp: hp,
      lastSavedAt: Date.now(),
      mana: 50,
      manaMax: 100,
      mercenariesLevel: 0,
      familiars: {
        sprite: { level: 0, unlocked: false },
        golem: { level: 0, unlocked: false },
        dragon: { level: 0, unlocked: false },
      },
      spells: {
        arcaneBurstEndAt: 0,
        arcaneBurstCdEndAt: 0,
        timeWarpEndAt: 0,
        timeWarpCdEndAt: 0,
        armorBreakCdEndAt: 0,
      },
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
        mana,
        manaMax,
        mercenariesLevel,
        familiars,
        spells,
      });
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [
    gold,
    level,
    tapDamage,
    passiveIncome,
    monsterMaxHp,
    monsterHp,
    mana,
    manaMax,
    mercenariesLevel,
    familiars,
    spells,
  ]);

  const containerRef = useRef<HTMLDivElement | null>(null);

  // Level-gated upgrade requirements
  const canBuyBlade = level >= 1;
  const canBuyMiners = level >= 3;
  const canBuyArcaneForge = level >= 5;

  return (
    <div
      ref={containerRef}
      className="with-aurora min-h-screen w-full flex flex-col items-center justify-between p-4 sm:p-6 text-foreground bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-950 via-slate-950 to-black"
    >
      {/* Header */}
      <header className="w-full max-w-md flex items-center justify-between">
        <div>
          <h1 className="font-fantasy title-glow text-3xl sm:text-4xl text-indigo-200 tracking-wide">
            Arcane Clicker
          </h1>
          <p className="text-xs text-indigo-300/80">
            Level {level} • {currentZone.name}
            {isBossLevel ? " • Boss" : ""}
          </p>
        </div>
        <button
          onClick={handleHardReset}
          className="text-[10px] uppercase tracking-widest text-rose-300/70 hover:text-rose-200"
        >
          Reset
        </button>
      </header>

      {/* Stats */}
      <section className="w-full max-w-md mt-4 grid grid-cols-4 gap-2 text-center">
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

      {/* Spells */}
      <section className="w-full max-w-md mt-4 grid grid-cols-3 gap-2">
        <button
          onClick={() => {
            const now = Date.now();
            const cd = Math.floor(45000 * currentZone.spellCdMultiplier);
            if (mana < 30 || now < spells.arcaneBurstCdEndAt) return;
            setMana((m) => m - 30);
            setSpells((s) => ({
              ...s,
              arcaneBurstEndAt: now + 10000,
              arcaneBurstCdEndAt: now + cd,
            }));
          }}
          disabled={mana < 30 || Date.now() < spells.arcaneBurstCdEndAt}
          className="rounded-lg p-2 text-left bg-slate-900/60 ring-1 ring-white/10 disabled:opacity-50"
        >
          <div className="text-sm text-indigo-200">Arcane Burst</div>
          <div className="text-[11px] text-indigo-300/80">Tap x3 for 10s</div>
          <div className="text-[10px] text-blue-300/80">
            Mana 30 • CD{" "}
            {Math.ceil(
              Math.max(0, (spells.arcaneBurstCdEndAt - Date.now()) / 1000)
            )}
            s
          </div>
        </button>
        <button
          onClick={() => {
            const now = Date.now();
            const cd = Math.floor(60000 * currentZone.spellCdMultiplier);
            if (mana < 40 || now < spells.timeWarpCdEndAt) return;
            setMana((m) => m - 40);
            setSpells((s) => ({
              ...s,
              timeWarpEndAt: now + 20000,
              timeWarpCdEndAt: now + cd,
            }));
          }}
          disabled={mana < 40 || Date.now() < spells.timeWarpCdEndAt}
          className="rounded-lg p-2 text-left bg-slate-900/60 ring-1 ring-white/10 disabled:opacity-50"
        >
          <div className="text-sm text-indigo-200">Time Warp</div>
          <div className="text-[11px] text-indigo-300/80">
            Gold/s x2 for 20s
          </div>
          <div className="text-[10px] text-blue-300/80">
            Mana 40 • CD{" "}
            {Math.ceil(
              Math.max(0, (spells.timeWarpCdEndAt - Date.now()) / 1000)
            )}
            s
          </div>
        </button>
        <button
          onClick={() => {
            const now = Date.now();
            const cd = Math.floor(90000 * currentZone.spellCdMultiplier);
            if (mana < 50 || now < spells.armorBreakCdEndAt || !isBossLevel)
              return;
            setMana((m) => m - 50);
            setMonsterHp((hp) => Math.max(1, Math.floor(hp * 0.8)));
            setSpells((s) => ({ ...s, armorBreakCdEndAt: now + cd }));
          }}
          disabled={
            mana < 50 || Date.now() < spells.armorBreakCdEndAt || !isBossLevel
          }
          className="rounded-lg p-2 text-left bg-slate-900/60 ring-1 ring-white/10 disabled:opacity-50"
        >
          <div className="text-sm text-indigo-200">Armor Break</div>
          <div className="text-[11px] text-indigo-300/80">Boss -20% HP</div>
          <div className="text-[10px] text-blue-300/80">
            Mana 50 • CD{" "}
            {Math.ceil(
              Math.max(0, (spells.armorBreakCdEndAt - Date.now()) / 1000)
            )}
            s
          </div>
        </button>
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
          {isBossLevel && (
            <div className="mb-2 text-[11px] text-rose-300/80">
              Boss enrage dans:{" "}
              {bossDeadlineAt
                ? Math.max(0, Math.ceil((bossDeadlineAt - Date.now()) / 1000))
                : 30}
              s
            </div>
          )}
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
            <div
              className={`relative w-40 sm:w-48 aspect-square ${
                shakeKey ? "shake" : ""
              }`}
              onAnimationEnd={() => setShakeKey(0)}
            >
              {/* vary monster skin with zone */}
              <div
                className={
                  "absolute inset-0 rounded-full ring-1 ring-white/20 shadow-2xl " +
                  (level <= 20
                    ? "bg-gradient-to-b from-emerald-200 to-emerald-600"
                    : level <= 40
                    ? "bg-gradient-to-b from-purple-300 to-purple-700"
                    : "bg-gradient-to-b from-sky-300 to-sky-700")
                }
              />
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

            {/* Allies orbiting monster (sprite/golem/dragon) */}
            <div className="pointer-events-none absolute inset-0">
              {familiars.sprite.unlocked && (
                <div
                  className="ally"
                  style={
                    {
                      "--ang": "20deg",
                      "--rad": "56px",
                    } as React.CSSProperties & {
                      "--ang"?: string;
                      "--rad"?: string;
                    }
                  }
                >
                  <div className="ally-icon bg-emerald-400/80 ring-1 ring-white/20">
                    ✨
                  </div>
                </div>
              )}
              {familiars.golem.unlocked && (
                <div
                  className="ally"
                  style={
                    {
                      "--ang": "160deg",
                      "--rad": "62px",
                    } as React.CSSProperties & {
                      "--ang"?: string;
                      "--rad"?: string;
                    }
                  }
                >
                  <div className="ally-icon bg-rose-400/80 ring-1 ring-white/20">
                    🪨
                  </div>
                </div>
              )}
              {familiars.dragon.unlocked && (
                <div
                  className="ally"
                  style={
                    {
                      "--ang": "280deg",
                      "--rad": "60px",
                    } as React.CSSProperties & {
                      "--ang"?: string;
                      "--rad"?: string;
                    }
                  }
                >
                  <div className="ally-icon bg-yellow-300/80 ring-1 ring-white/20">
                    🐉
                  </div>
                </div>
              )}
            </div>

            {/* Slashes */}
            {slashes.map((s) => (
              <div
                key={s.id}
                className="slash"
                style={
                  {
                    left: s.x,
                    top: s.y,
                    transformOrigin: "center",
                    "--angle": `${s.angle}deg`,
                    "--sx": `${Math.cos((s.angle * Math.PI) / 180) * -14}px`,
                    "--sy": `${Math.sin((s.angle * Math.PI) / 180) * 14}px`,
                  } as SlashStyle
                }
              />
            ))}

            {/* Damage pops */}
            {damagePops.map((d) => (
              <div
                key={d.id}
                className={`damage-pop ${d.crit ? "crit" : ""}`}
                style={{ left: d.x, top: d.y }}
              >
                {d.crit ? `${d.value}!` : d.value}
              </div>
            ))}

            {/* Auto-attack sparks */}
            {sparks.map((sp) => (
              <div
                key={sp.id}
                className="spark-pop"
                style={
                  {
                    left: `${sp.x}%`,
                    top: `${sp.y}%`,
                    "--spark": sp.color,
                  } as React.CSSProperties & { "--spark"?: string }
                }
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
          <div className="mt-1 text-amber-300 text-sm">
            Cost: {formatNumber(nextTapUpgradeCost)} gold
          </div>
          {!canBuyBlade && (
            <div className="mt-1 text-[10px] text-rose-300/70">
              Unlocks at Lv 1
            </div>
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
          <div className="mt-1 text-amber-300 text-sm">
            Cost: {formatNumber(nextPassiveUpgradeCost)} gold
          </div>
          {!canBuyMiners && (
            <div className="mt-1 text-[10px] text-rose-300/70">
              Unlocks at Lv 3
            </div>
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
          <div className="text-sm font-fantasy text-indigo-200">
            Arcane Forge
          </div>
          <div className="text-[11px] text-indigo-300/80">+3 DMG per tap</div>
          <div className="mt-1 text-amber-300 text-sm">Cost: 100 gold</div>
          {!canBuyArcaneForge && (
            <div className="mt-1 text-[10px] text-rose-300/70">
              Unlocks at Lv 5
            </div>
          )}
        </button>

        {/* Mercenaries (DPS line) */}
        <button
          onClick={() => {
            const cost = Math.ceil(50 * Math.pow(1.25, mercenariesLevel));
            if (gold < cost) return;
            setGold((g) => g - cost);
            setMercenariesLevel((m) => m + 1);
          }}
          className="rounded-xl p-3 text-left bg-slate-900/60 ring-1 ring-white/10 hover:ring-indigo-400/40 hover:bg-slate-900/70"
        >
          <div className="text-sm font-fantasy text-indigo-200">
            Mercenaries
          </div>
          <div className="text-[11px] text-indigo-300/80">
            +1 auto-hit / sec
          </div>
          <div className="mt-1 text-amber-300 text-sm">
            Lvl: {mercenariesLevel} • Cost:{" "}
            {formatNumber(Math.ceil(50 * Math.pow(1.25, mercenariesLevel)))}{" "}
            gold
          </div>
        </button>
      </section>

      {/* Familiars */}
      <section className="w-full max-w-md grid grid-cols-3 gap-2 mb-4">
        <button
          onClick={() => {
            if (!familiars.sprite.unlocked) return;
            const cost = 30 + familiars.sprite.level * 20;
            if (gold < cost) return;
            setGold((g) => g - cost);
            setFamiliars((f) => ({
              ...f,
              sprite: { ...f.sprite, level: f.sprite.level + 1 },
            }));
          }}
          disabled={!familiars.sprite.unlocked}
          className="rounded-lg p-2 bg-slate-900/60 ring-1 ring-white/10 disabled:opacity-50"
        >
          <div className="text-sm text-indigo-200">Sprite</div>
          <div className="text-[11px] text-indigo-300/80">1 hit/sec</div>
          <div className="text-[10px] text-amber-300">
            Lvl {familiars.sprite.level} • Cost{" "}
            {30 + familiars.sprite.level * 20}
          </div>
          {!familiars.sprite.unlocked && (
            <div className="text-[10px] text-rose-300/70 mt-1">Unlock Lv 5</div>
          )}
        </button>
        <button
          onClick={() => {
            if (!familiars.golem.unlocked) return;
            const cost = 200 + familiars.golem.level * 120;
            if (gold < cost) return;
            setGold((g) => g - cost);
            setFamiliars((f) => ({
              ...f,
              golem: { ...f.golem, level: f.golem.level + 1 },
            }));
          }}
          disabled={!familiars.golem.unlocked}
          className="rounded-lg p-2 bg-slate-900/60 ring-1 ring-white/10 disabled:opacity-50"
        >
          <div className="text-sm text-indigo-200">Golem</div>
          <div className="text-[11px] text-indigo-300/80">AOE slam (rare)</div>
          <div className="text-[10px] text-amber-300">
            Lvl {familiars.golem.level} • Cost{" "}
            {200 + familiars.golem.level * 120}
          </div>
          {!familiars.golem.unlocked && (
            <div className="text-[10px] text-rose-300/70 mt-1">
              Unlock Lv 20
            </div>
          )}
        </button>
        <button
          onClick={() => {
            if (!familiars.dragon.unlocked) return;
            const cost = 1000 + familiars.dragon.level * 600;
            if (gold < cost) return;
            setGold((g) => g - cost);
            setFamiliars((f) => ({
              ...f,
              dragon: { ...f.dragon, level: f.dragon.level + 1 },
            }));
          }}
          disabled={!familiars.dragon.unlocked}
          className="rounded-lg p-2 bg-slate-900/60 ring-1 ring-white/10 disabled:opacity-50"
        >
          <div className="text-sm text-indigo-200">Dragonnet</div>
          <div className="text-[11px] text-indigo-300/80">+2% crit / lvl</div>
          <div className="text-[10px] text-amber-300">
            Lvl {familiars.dragon.level} • Cost{" "}
            {1000 + familiars.dragon.level * 600}
          </div>
          {!familiars.dragon.unlocked && (
            <div className="text-[10px] text-rose-300/70 mt-1">
              Unlock Lv 60
            </div>
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
