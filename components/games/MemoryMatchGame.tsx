'use client';

import React, { useEffect, useRef, useState } from 'react';
import { soundManager } from '@/lib/sound';

interface MemoryMatchGameProps {
  onWin: () => void;
  onLose: () => void;
  onProgress: (action: 'memoryPairMatched') => Promise<boolean>;
  minSeconds: number;
  isPaused: boolean;
}

interface CardItem {
  id: number;
  symbol: string;
  name: string;
  isFlipped: boolean;
  isMatched: boolean;
}

const SYMBOLS = [
  { symbol: '⚡', name: 'POWER' },
  { symbol: '🤖', name: 'CPU' },
  { symbol: '⚙️', name: 'GEAR' },
];

const PREVIEW_SECONDS = 4;

function createDeck(): CardItem[] {
  const deck = SYMBOLS.flatMap((item, symbolIndex) =>
    [0, 1].map((copy) => ({
      id: symbolIndex * 2 + copy,
      symbol: item.symbol,
      name: item.name,
      isFlipped: true,
      isMatched: false,
    }))
  );

  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export default function MemoryMatchGame({ onWin, onLose, onProgress, minSeconds, isPaused }: MemoryMatchGameProps) {
  const [cards, setCards] = useState<CardItem[]>(createDeck);
  const [flippedIndices, setFlippedIndices] = useState<number[]>([]);
  const [resolvingPair, setResolvingPair] = useState(false);
  const [matchesCount, setMatchesCount] = useState(0);
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  const [previewSeconds, setPreviewSeconds] = useState(PREVIEW_SECONDS);
  const [gameWon, setGameWon] = useState(false);
  const [waitingForMinimum, setWaitingForMinimum] = useState(false);
  const pausedRef = useRef(isPaused);
  const flippedRef = useRef<number[]>([]);
  const resolvingRef = useRef(false);
  const winNotifiedRef = useRef(false);
  const previewRef = useRef(true);
  const secondsElapsedRef = useRef(0);
  const pendingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressPromiseRef = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    pausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (pausedRef.current) return;

      secondsElapsedRef.current += 1;
      setSecondsElapsed(secondsElapsedRef.current);
      if (previewRef.current) {
        setPreviewSeconds((remaining) => {
          if (remaining <= 1) {
            previewRef.current = false;
            setCards((current) => current.map((card) => ({ ...card, isFlipped: false })));
            return 0;
          }
          return remaining - 1;
        });
      }
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (waitingForMinimum && secondsElapsed >= minSeconds && !winNotifiedRef.current) {
      winNotifiedRef.current = true;
      setWaitingForMinimum(false);
      soundManager.playLevelClear();
      void (progressPromiseRef.current || Promise.resolve(true)).then((ready) => {
        if (ready) onWin();
      });
    }
  }, [minSeconds, onWin, secondsElapsed, waitingForMinimum]);

  useEffect(() => () => {
    if (pendingTimeoutRef.current) clearTimeout(pendingTimeoutRef.current);
  }, []);

  const handleCardClick = (index: number) => {
    if (
      pausedRef.current ||
      previewRef.current ||
      gameWon ||
      resolvingRef.current ||
      flippedRef.current.length >= 2
    ) return;

    const selected = cards[index];
    if (!selected || selected.isMatched || selected.isFlipped) return;

    soundManager.playBeep(480, 0.05);
    const firstSelection = flippedRef.current.length === 0;
    const nextFlipped = [...flippedRef.current, index];
    flippedRef.current = nextFlipped;
    setFlippedIndices(nextFlipped);
    setCards((current) => current.map((card, cardIndex) =>
      cardIndex === index ? { ...card, isFlipped: true } : card
    ));

    if (firstSelection) return;

    resolvingRef.current = true;
    setResolvingPair(true);
    const firstIndex = nextFlipped[0];
    const isMatch = cards[firstIndex].symbol === selected.symbol;

    const resolvePair = () => {
      if (pausedRef.current) {
        pendingTimeoutRef.current = setTimeout(resolvePair, 200);
        return;
      }

      if (isMatch) {
        soundManager.playCoin();
        setCards((current) => current.map((card, cardIndex) =>
          cardIndex === firstIndex || cardIndex === index
            ? { ...card, isMatched: true, isFlipped: true }
            : card
        ));
        const nextCount = matchesCount + 1;
        setMatchesCount(nextCount);
        const progressPromise = onProgress('memoryPairMatched');
        progressPromiseRef.current = progressPromise;
        if (nextCount === SYMBOLS.length) {
          setGameWon(true);
          if (secondsElapsedRef.current >= minSeconds) {
            winNotifiedRef.current = true;
            soundManager.playLevelClear();
            void progressPromise.then((ready) => {
              if (ready) onWin();
            });
          } else {
            setWaitingForMinimum(true);
          }
        }
      } else {
        soundManager.playDamage();
        setCards((current) => current.map((card, cardIndex) =>
          cardIndex === firstIndex || cardIndex === index
            ? { ...card, isFlipped: false }
            : card
        ));
      }

      flippedRef.current = [];
      setFlippedIndices([]);
      resolvingRef.current = false;
      setResolvingPair(false);
    };

    pendingTimeoutRef.current = setTimeout(resolvePair, isMatch ? 450 : 1000);
  };

  return (
    <div className="flex flex-col items-center justify-center p-4">
      <div className="flex items-center justify-between w-full max-w-[440px] mb-3 px-4 py-2 bg-retro-card border border-retro-cyan/40 rounded">
        <div>
          <span className="text-sm text-retro-cyan font-pixel">PAIRS: </span>
          <span className="font-pixel text-retro-yellow text-sm font-bold">
            {matchesCount}/3
          </span>
        </div>
        <div>
          <span className="text-sm text-retro-muted font-pixel">TIME: </span>
          <span className={`font-pixel text-sm font-bold ${secondsElapsed < minSeconds ? 'text-retro-amber' : 'text-retro-green'}`}>
            {secondsElapsed}s / {minSeconds}s
          </span>
        </div>
      </div>

      <p className="mb-3 text-sm text-retro-cyan font-pixel text-center" aria-live="polite">
        {previewRef.current && previewSeconds > 0
          ? `MEMORIZE THE CARDS: ${previewSeconds}s`
          : resolvingPair ? 'CHECKING PAIR...' : 'MATCH 3 PAIRS'}
      </p>

      <div className="relative p-3 bg-retro-bg border-2 border-retro-cyan shadow-neon-cyan rounded grid grid-cols-3 gap-3 max-w-[440px]">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.35)_50%)] bg-[length:100%_4px] opacity-30 rounded" />
        {cards.map((card, index) => {
          const isOpen = card.isFlipped || card.isMatched;
          return (
            <button
              key={card.id}
              onClick={() => handleCardClick(index)}
              disabled={isPaused || previewRef.current || isOpen || resolvingPair || gameWon}
              aria-label={isOpen ? `${card.name}${card.isMatched ? ', matched' : ''}` : 'Hidden card'}
              className={`w-24 h-24 sm:w-28 sm:h-28 rounded border flex flex-col items-center justify-center transition-all duration-200 select-none touch-manipulation disabled:cursor-default ${
                card.isMatched
                  ? 'bg-retro-card border-retro-green shadow-neon-green opacity-90'
                  : isOpen
                  ? 'bg-retro-card border-retro-cyan shadow-neon-cyan'
                  : 'bg-[#0d1020] border-retro-border hover:border-retro-cyan/60 active:scale-95'
              }`}
            >
              {isOpen ? (
                <>
                  <span className="text-3xl mb-1">{card.symbol}</span>
                  <span className="text-[10px] font-pixel text-retro-cyan">
                    {card.name}
                  </span>
                  {card.isMatched && <span className="text-xs text-retro-green font-pixel">MATCHED</span>}
                </>
              ) : (
                <span className="font-pixel text-retro-muted text-lg">?</span>
              )}
            </button>
          );
        })}

        {gameWon && (
          <div className="absolute inset-0 bg-black/85 flex flex-col items-center justify-center rounded text-center p-3">
            <h2 className="font-pixel text-retro-green text-xl mb-2 motion-safe:animate-bounce">3 PAIRS MATCHED!</h2>
            <p className="text-sm text-retro-cyan font-pixel">
              {waitingForMinimum ? `MINIMUM TIME ${secondsElapsed}s / ${minSeconds}s` : 'WIN SUBMITTING...'}
            </p>
          </div>
        )}
      </div>

      <button
        onClick={onLose}
        disabled={isPaused || gameWon || resolvingPair}
        className="mt-4 px-4 py-3 text-sm font-pixel text-retro-red/80 hover:text-retro-red underline uppercase disabled:opacity-40"
      >
        FORFEIT GAME (-1 LIFELINE & REVEAL CLUE)
      </button>
    </div>
  );
}
