import { dateFormats, formatDate, isDateFormat, writeDateFormat } from "../lib/dateFormat";
import { useDateFormat } from "../lib/useDateFormat";

const exampleDate = new Date(2026, 8, 6);

export function DateFormatSetting() {
  const format = useDateFormat();
  return <label className="setting-row">
    <span>Date format<small className="setting-description">For dates inserted with /date in all notebooks</small></span>
    <select className="settings-select" aria-label="Date format" value={format} onChange={event => {
      if (isDateFormat(event.target.value)) writeDateFormat(event.target.value);
    }}>
      {dateFormats.map(value => <option key={value} value={value}>
        {value === "locale" ? "System locale" : value.toUpperCase()} ({formatDate(exampleDate, value)})
      </option>)}
    </select>
  </label>;
}
