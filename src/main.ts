/**
 * main.ts — 入口：找到 canvas，启动游戏。
 */
import "./style.css";
import { Game } from "./game";

const canvas = document.getElementById("scene");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("找不到 #scene canvas");
}

const game = new Game(canvas);
void game.start();

// 挂到 window 上方便调试
(window as unknown as { game: Game }).game = game;
