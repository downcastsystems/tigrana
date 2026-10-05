import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type TextareaHTMLAttributes } from "react";
import { CalendarDays } from "lucide-react";
import { DatePickerForm } from "../editor/DatePickerDialog";
import { isTitleCaretOnLastLine } from "../lib/titleArrowNavigation";

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value"> & {
  value: string;
  documentKey: string;
  onInsertDate: (title: string) => void;
  onCommit: () => void;
  onFocusContent?: () => void;
};

type DateRequest = { value: string; documentKey: string; from: number; to: number };

function dateCommand(input: HTMLTextAreaElement) {
  const caret = input.selectionStart;
  if (caret !== input.selectionEnd || (input.value[caret] && !/\s/.test(input.value[caret]))) return null;
  const match = /(?:^|\s)\/date$/i.exec(input.value.slice(0, caret));
  return match ? { from: caret - 5, to: caret } : null;
}

export const NoteTitleInput = forwardRef<HTMLTextAreaElement, Props>(function NoteTitleInput({
  value, documentKey, onInsertDate, onCommit, onFocusContent, disabled, onChange, onKeyDown, onBlur, onFocus, onSelect, ...props
}, forwardedRef) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(forwardedRef, () => inputRef.current!, []);
  const [request, setRequest] = useState<DateRequest | null>(null);
  const [showCommand, setShowCommand] = useState(false);
  // Opening the calendar moves focus before React has finished committing it.
  const openingCalendar = useRef(false);
  const restoreCaret = useRef<number | null>(null);
  const activeRequest = !disabled && request?.value === value && request.documentKey === documentKey ? request : null;

  useEffect(() => {
    setRequest(null);
    openingCalendar.current = false;
    setShowCommand(false);
  }, [documentKey, disabled]);
  useEffect(() => {
    if (request && request.value !== value) {
      setRequest(null);
      openingCalendar.current = false;
    }
  }, [request, value]);
  useLayoutEffect(() => {
    if (restoreCaret.current === null || !inputRef.current) return;
    inputRef.current.focus({ preventScroll: true });
    inputRef.current.setSelectionRange(restoreCaret.current, restoreCaret.current);
    restoreCaret.current = null;
  });

  const openCalendar = () => {
    const range = inputRef.current && dateCommand(inputRef.current);
    if (disabled || !range) return;
    openingCalendar.current = true;
    setShowCommand(false);
    setRequest({ value, documentKey, ...range });
  };
  const closeCalendar = (caret: number) => {
    openingCalendar.current = false;
    restoreCaret.current = caret;
    setRequest(null);
  };

  return <>
    <textarea {...props} ref={inputRef} value={value} disabled={disabled}
      onChange={event => {
        setShowCommand(Boolean(dateCommand(event.currentTarget)));
        onChange?.(event);
      }}
      onSelect={event => {
        setShowCommand(!openingCalendar.current && Boolean(dateCommand(event.currentTarget)));
        onSelect?.(event);
      }}
      onFocus={event => {
        setShowCommand(Boolean(dateCommand(event.currentTarget)));
        onFocus?.(event);
      }}
      onBlur={event => {
        setShowCommand(false);
        onBlur?.(event);
        // Do not commit a filename containing the command while choosing a date.
        if (!openingCalendar.current) onCommit();
      }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (!disabled && onFocusContent && event.key === "ArrowDown"
          && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey
          && isTitleCaretOnLastLine(event.currentTarget)) {
          event.preventDefault();
          onFocusContent();
          return;
        }
        if (!disabled && (event.key === "Enter" || event.key === "Tab") && dateCommand(event.currentTarget)) {
          event.preventDefault();
          event.stopPropagation();
          openCalendar();
          return;
        }
        onKeyDown?.(event);
      }}
    />
    {showCommand && !disabled && !activeRequest ? <button type="button" className="title-date-command"
      onMouseDown={event => event.preventDefault()} onClick={openCalendar}>
      <CalendarDays size={16} /> Insert date <kbd>Enter</kbd>
    </button> : null}
    {activeRequest ? <DatePickerForm
      portalTarget={inputRef.current?.closest('[data-theme-region]') ?? document.body}
      onDismiss={() => closeCalendar(activeRequest.to)}
      onInsert={text => {
        onInsertDate(value.slice(0, activeRequest.from) + text + value.slice(activeRequest.to));
        closeCalendar(activeRequest.from + text.length);
      }}
    /> : null}
  </>;
});
