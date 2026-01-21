import { db } from "./firebase.js";
import { ref, set, onValue, remove } 
from "https://www.gstatic.com/firebasejs/12.8.0/firebase-database.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const GRID = 20;
const SIZE = 18;

const playerId = "player_" + Math.floor(Math.random() * 99999);
const playerRef = ref(db, "players/" + playerId);

let snake = [{ x: 200, y: 200 }];
let dir = { x: GRID, y: 0 };

document.addEventListener("keydown", e => {
  if (e.key === "ArrowUp") dir = { x: 0, y: -GRID };
  if (e.key === "ArrowDown") dir = { x: 0, y: GRID };
  if (e.key === "ArrowLeft") dir = { x: -GRID, y: 0 };
  if (e.key === "ArrowRight") dir = { x: GRID, y: 0 };
});

function update() {
  const head = {
    x: (snake[0].x + dir.x + 400) % 400,
    y: (snake[0].y + dir.y + 400) % 400
  };

  snake.unshift(head);
  snake.pop();

  set(playerRef, snake);
}

onValue(ref(db, "players"), snap => {
  ctx.clearRect(0, 0, 400, 400);
  const players = snap.val();
  if (!players) return;

  Object.values(players).forEach(s => {
    s.forEach(p => {
      ctx.fillRect(p.x, p.y, SIZE, SIZE);
    });
  });
});

window.addEventListener("beforeunload", () => {
  remove(playerRef);
});

setInterval(update, 150);

