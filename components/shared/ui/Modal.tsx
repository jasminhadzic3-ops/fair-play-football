"use client";

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
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 pointer-events-none">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black bg-opacity-50 transition-opacity pointer-events-auto"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative flex min-h-full items-center justify-center p-4 pointer-events-none">
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-5xl md:max-w-6xl w-full max-h-[90vh] overflow-y-auto shadow-2xl pointer-events-auto">
          {/* Header */}
          <div className="sticky top-0 bg-zinc-900 border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
            <h2 className="text-2xl font-bold text-white">{title}</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white transition text-2xl leading-none"
            >
              ✕
            </button>
          </div>

          {/* Content */}
          <div className="px-6 py-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
