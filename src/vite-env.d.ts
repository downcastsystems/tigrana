/// <reference types="vite/client" />

declare module "nspell" {
  type NSpell = {
    correct(word: string): boolean;
    spell(word: string): boolean;
    suggest(word: string): string[];
    add(word: string, model?: string): void;
  };

  export default function nspell(aff: string, dic: string): NSpell;
}
