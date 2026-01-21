import { db } from "./firebase.js";
import { ref, set, onValue, update, remove } 
from "https://www.gstatic.com/firebasejs/12.8.0/firebase-database.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const GRID = 20;
const SIZE = 18;
const WIDTH = 400;

let room = null;
const playerId = "p" + Math.floor(Math.random() * 99999);

let snake = [{ x: 200, y: 200 }];
let dir = { x: GRID, y: 0 };
let score = 0;
let alive = true;

/* ========== INPUT ========== */
document.addEventListener("keydown", e => {
  if (e.key === "ArrowUp") dir = { x: 0, y: -GRID };
  if (e.key === "ArrowDown") dir = { x: 0, y: GRID };
  if (e.key === "ArrowLeft") dir = { x: -GRID, y: 0 };
  if (e.key === "ArrowRight") dir = { x: GRID, y: 0 };
});

/* ========== JOIN ROOM ========== */
document.getElementById("joinBtn").onclick = () => {
  room = document.getElementById("roomInput").value;
  if (!room) return alert("Isi nama room!");

  document.getElementById("roomText").innerText = "Room: " + room;
  document.getElementById("lobby").style.display = "none";

  const foodRef = ref(db, `rooms/${room}/food`);
  set(foodRef, {
    x: Math.floor(Math.random() * 20) * GRID,
    y: Math.floor(Math.random() * 20) * GRID
  });

  gameLoop();
};

/* ========== GAME LOOP ========== */
function gameLoop() {
  const playerRef = ref(db, `rooms/${room}/players/${playerId}`);

  setInterval(() => {
    if (!alive) return;

    const head = {
      x: snake[0].x + dir.x,
      y: snake[0].y + dir.y
    };

    // WALL COLLISION
    if (head.x < 0 || head.y < 0 || head.x >= WIDTH || head.y >= WIDTH) {
      alive = false;
      remove(playerRef);
      alert("Game Over!");
      return;
    }

    snake.unshift(head);

    onValue(ref(db, `rooms/${room}/food`), snap => {
      const food = snap.val();
      if (food && head.x === food.x && head.y === food.y) {
        score++;
        set(ref(db, `rooms/${room}/food`), {
          x: Math.floor(Math.random() * 20) * GRID,
          y: Math.floor(Math.random() * 20) * GRID
        });
      } else {
        snake.pop();
      }
    }, { onlyOnce: true });

    set(playerRef, { snake, score });

  }, 150);

  onValue(ref(db, `rooms/${room}`), snap => {
    ctx.clearRect(0, 0, WIDTH, WIDTH);
    const data = snap.val();
    if (!data) return;

    // FOOD
    ctx.fillStyle = "red";
    ctx.fillRect(data.food.x, data.food.y, SIZE, SIZE);

    // PLAYERS
    ctx.fillStyle = "black";
    Object.entries(data.players || {}).forEach(([id, p]) => {
      p.snake.forEach(part => {
        ctx.fillRect(part.x, part.y, SIZE, SIZE);
      });

      // COLLISION ANTAR SNAKE
      if (id !== playerId) {
        p.snake.forEach(part => {
          if (part.x === snake[0].x && part.y === snake[0].y) {
            alive = false;
            remove(playerRef);
            alert("Tabrakan dengan player lain!");
          }
        });
      }
    });

    document.getElementById("scoreText").innerText = "Score: " + score;
  });
}

/* ========== CLEANUP ========== */
window.addEventListener("beforeunload", () => {
  if (room) remove(ref(db, `rooms/${room}/players/${playerId}`));
});
