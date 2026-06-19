"use client";

import { useEffect } from "react";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
}: ModalProps) {
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black pointer-events-none overscroll-none">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/90 transition-opacity pointer-events-auto"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative flex h-[100dvh] w-screen items-stretch justify-center p-0 pointer-events-none overscroll-none sm:items-center">
        <div className="flex h-[100dvh] w-screen flex-col overflow-hidden rounded-none border border-zinc-800 bg-zinc-900 shadow-2xl pointer-events-auto overscroll-contain sm:h-[99vh] sm:w-[88vw] sm:rounded-2xl">
          {/* Header */}
          <div className="shrink-0 bg-zinc-900 border-b border-zinc-800 px-3 py-2.5 flex items-center justify-between sm:px-6 sm:py-4">
            <h2 className="text-lg font-bold text-white sm:text-2xl">{title}</h2>
            <button
              onClick={onClose}
              className="flex h-11 w-11 items-center justify-center text-gray-400 hover:text-white transition text-xl leading-none sm:text-2xl"
            >
              ✕
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-8 sm:py-7">{children}</div>
        </div>
      </div>
    </div>
  );
}
