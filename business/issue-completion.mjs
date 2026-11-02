import {BusinessError, date, koreanToday} from './domain.mjs';

// Compare calendar strings, never local instants. Unchanged legacy values remain editable.
export function validateIssueCompletionDate(value, occurDate, previous = undefined, today = koreanToday()) {
  if (typeof value !== 'string') throw new BusinessError(400, '실제 완료일은 YYYY-MM-DD 날짜 또는 빈 값으로 입력하세요.');
  if (value === previous || value === '') return value;
  date(value, '실제 완료일');
  if (value > today) throw new BusinessError(400, '실제 완료일은 한국 날짜 기준 오늘 이후일 수 없습니다.');
  let validOccurrence = false;
  try { date(occurDate, '발생일'); validOccurrence = true; } catch { /* Preserve undated legacy records. */ }
  if (validOccurrence && value < occurDate) throw new BusinessError(400, '실제 완료일은 발생일 이전일 수 없습니다.');
  return value;
}
