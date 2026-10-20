declare module '*.css';
declare module '*.png' {
  const src: string;
  export default src;
}
interface Window {
  api: import('./types').Api;
}
declare module '*.svg' {
  const src: string;
  export default src;
}
