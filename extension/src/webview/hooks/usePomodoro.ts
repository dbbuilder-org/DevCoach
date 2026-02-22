import { useState, useEffect, useRef, useCallback } from 'react';

const POMODORO_SECONDS = 25 * 60;
const SHORT_BREAK_SECONDS = 5 * 60;

interface UsePomodoroReturn {
  secondsLeft: number;
  isRunning: boolean;
  isBreak: boolean;
  pomodoroCount: number;
  start: () => void;
  pause: () => void;
  reset: () => void;
  skip: () => void;
}

export function usePomodoro(onComplete: (isBreak: boolean) => void): UsePomodoroReturn {
  const [secondsLeft, setSecondsLeft] = useState(POMODORO_SECONDS);
  const [isRunning, setIsRunning] = useState(false);
  const [isBreak, setIsBreak] = useState(false);
  const [pomodoroCount, setPomodoroCount] = useState(0);

  // Stable ref for the callback so the interval doesn't capture a stale closure
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    if (!isRunning) return;

    const interval = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          setIsRunning(false);

          if (!isBreak) {
            // Pomodoro just finished
            setPomodoroCount(c => c + 1);
            setIsBreak(true);
            setSecondsLeft(SHORT_BREAK_SECONDS);
            onCompleteRef.current(false);
          } else {
            // Break just finished
            setIsBreak(false);
            setSecondsLeft(POMODORO_SECONDS);
            onCompleteRef.current(true);
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning, isBreak]);

  const start = useCallback(() => setIsRunning(true), []);
  const pause = useCallback(() => setIsRunning(false), []);

  const reset = useCallback(() => {
    setIsRunning(false);
    setIsBreak(false);
    setSecondsLeft(POMODORO_SECONDS);
  }, []);

  const skip = useCallback(() => {
    setIsRunning(false);
    if (isBreak) {
      setIsBreak(false);
      setSecondsLeft(POMODORO_SECONDS);
    } else {
      setPomodoroCount(c => c + 1);
      setIsBreak(true);
      setSecondsLeft(SHORT_BREAK_SECONDS);
    }
  }, [isBreak]);

  return { secondsLeft, isRunning, isBreak, pomodoroCount, start, pause, reset, skip };
}
