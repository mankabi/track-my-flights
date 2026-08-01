import { AlertIcon } from "./icons";
import { useI18n } from "../i18n";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** window.confirm 대신 쓰는 자체 확인 다이얼로그 (삭제 등 되돌릴 수 없는 액션용). */
export default function ConfirmModal({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  danger = true,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const { t } = useI18n();
  if (!open) return null;
  const resolvedConfirmLabel = confirmLabel ?? t("common.delete");
  const resolvedCancelLabel = cancelLabel ?? t("common.cancel");
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/40 px-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
              danger ? "bg-red-50 text-red-600" : "bg-sky-100 text-navy-800"
            }`}
          >
            <AlertIcon size={20} />
          </span>
          <div>
            <h2 className="text-base font-semibold text-navy-900">{title}</h2>
            {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            {resolvedCancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`rounded-full px-4 py-2 text-sm font-medium text-white ${
              danger ? "bg-red-600 hover:bg-red-700" : "bg-navy-800 hover:bg-navy-900"
            }`}
          >
            {resolvedConfirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
