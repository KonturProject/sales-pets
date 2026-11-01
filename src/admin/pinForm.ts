/** Проверка нового админ-PIN до отправки: 4–12 цифр (как на сервере), одинаковый в двух полях. */
export function checkNewPin(a: string, b: string): string | null {
  if (!/^\d{4,12}$/.test(a)) return 'PIN — от 4 до 12 цифр';
  return a === b ? null : 'PIN в двух полях не совпадают';
}
