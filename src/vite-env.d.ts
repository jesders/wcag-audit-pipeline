/// <reference types="astro/client" />

declare module "*.css?inline" {
  const css: string;
  export default css;
}
