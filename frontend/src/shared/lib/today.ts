/**
 * Today where the person is, as the date a form sends.
 *
 * `toISOString()` names the day in UTC, which is not the day the person is having: an hour
 * either side of midnight it offers yesterday or tomorrow, and a date nobody chose is saved
 * as the day a service started or ended. The parts are read off the local clock and written
 * the way the server reads them, rather than left to a locale.
 */
export const today = () => {
  const now = new Date();
  const padded = (value: number) => String(value).padStart(2, '0');

  return `${now.getFullYear()}-${padded(now.getMonth() + 1)}-${padded(now.getDate())}`;
};
