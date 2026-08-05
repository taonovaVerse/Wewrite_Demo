const overlayEl = (): HTMLElement => document.getElementById('quick-input-overlay')!;
const fieldEl = (): HTMLInputElement =>
  document.getElementById('quick-input-field') as HTMLInputElement;
const labelEl = (): HTMLElement => document.getElementById('quick-input-label')!;

/** 模态式快速输入，返回输入值；Esc 返回 null */
export function ask(
  labelText: string,
  placeholder = '',
  initial = '',
): Promise<string | null> {
  return new Promise((resolve) => {
    const ov = overlayEl();
    const input = fieldEl();
    labelEl().textContent = labelText;
    input.value = initial;
    input.placeholder = placeholder;
    ov.classList.remove('hidden');
    input.focus();
    input.select();

    let done = false;
    const finish = (value: string | null): void => {
      if (done) return;
      done = true;
      ov.classList.add('hidden');
      window.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        finish(input.value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(null);
      }
    };
    window.addEventListener('keydown', onKey);
  });
}

export function isQuickInputOpen(): boolean {
  return !overlayEl().classList.contains('hidden');
}
