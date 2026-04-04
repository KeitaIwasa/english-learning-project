"use client";

import type { ModalState } from "./shared";

type NativeFixerAddCardModalProps = {
  modal: ModalState | null;
  addingCard: boolean;
  errorMessage: string;
  onClose: () => void;
  onChange: (next: ModalState) => void;
  onSubmit: () => void;
};

export function NativeFixerAddCardModal(props: NativeFixerAddCardModalProps) {
  if (!props.modal) {
    return null;
  }

  return (
    <div className="nfx-modal-backdrop" role="dialog" aria-modal="true" aria-label="フラッシュカード追加確認">
      <div className="nfx-modal panel">
        <h3>フラッシュカードに追加</h3>
        <label>
          修正後の英文
          <textarea
            value={props.modal.corrected}
            rows={3}
            onChange={(event) =>
              props.onChange({
                ...props.modal!,
                corrected: event.target.value
              })
            }
          />
        </label>
        <label>
          日本語訳
          <textarea
            value={props.modal.ja}
            rows={3}
            onChange={(event) =>
              props.onChange({
                ...props.modal!,
                ja: event.target.value
              })
            }
          />
        </label>
        <div className="nfx-modal-actions">
          <button type="button" className="secondary" onClick={props.onClose} disabled={props.addingCard}>
            キャンセル
          </button>
          <button type="button" onClick={props.onSubmit} disabled={props.addingCard}>
            {props.addingCard ? "追加中..." : "この内容で追加"}
          </button>
        </div>
        {props.errorMessage ? <p className="nfx-error">{props.errorMessage}</p> : null}
      </div>
    </div>
  );
}
