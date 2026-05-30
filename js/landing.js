document.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("automaton-canvas");
  const heroSection = document.getElementById("heroSection");
  const heroContent = document.getElementById("hero-content");

  if (!canvas || !heroSection || !heroContent) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let resolution = window.innerWidth < 640 ? 20 : 25;
  let grid = [];
  let cellAge = [];
  let cols = 0;
  let rows = 0;
  let userSparks = [];
  let animationFrameId = null;
  let isAnimating = !prefersReducedMotion;

  function create2DArray(totalCols, totalRows) {
    return Array.from({ length: totalCols }, () => new Array(totalRows).fill(0));
  }

  function setupGrid() {
    const pixelRatio = window.devicePixelRatio || 1;
    resolution = window.innerWidth < 640 ? 20 : 25;
    canvas.width = Math.floor(window.innerWidth * pixelRatio);
    canvas.height = Math.floor(window.innerHeight * pixelRatio);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    cols = Math.max(1, Math.floor(window.innerWidth / resolution));
    rows = Math.max(1, Math.floor(window.innerHeight / resolution));
    grid = create2DArray(cols, rows);
    cellAge = create2DArray(cols, rows);
  }

  function randomizeGrid() {
    for (let col = 0; col < cols; col += 1) {
      for (let row = 0; row < rows; row += 1) {
        grid[col][row] = Math.random() > 0.82 ? 1 : 0;
        cellAge[col][row] = grid[col][row];
      }
    }
  }

  function countNeighbors(sourceGrid, x, y) {
    let sum = 0;
    for (let i = -1; i < 2; i += 1) {
      for (let j = -1; j < 2; j += 1) {
        if (i === 0 && j === 0) continue;
        const col = (x + i + cols) % cols;
        const row = (y + j + rows) % rows;
        sum += sourceGrid[col][row];
      }
    }
    return sum;
  }

  function computeNextGeneration() {
    const nextGrid = create2DArray(cols, rows);
    for (let col = 0; col < cols; col += 1) {
      for (let row = 0; row < rows; row += 1) {
        const state = grid[col][row];
        const neighbors = countNeighbors(grid, col, row);
        if (state === 0 && neighbors === 3) {
          nextGrid[col][row] = 1;
          cellAge[col][row] = 1;
        } else if (state === 1 && (neighbors < 2 || neighbors > 3)) {
          nextGrid[col][row] = 0;
          cellAge[col][row] = 0;
        } else {
          nextGrid[col][row] = state;
          if (state === 1) cellAge[col][row] += 1;
        }
      }
    }
    return nextGrid;
  }

  function drawGrid() {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    for (let col = 0; col < cols; col += 1) {
      for (let row = 0; row < rows; row += 1) {
        if (grid[col][row] !== 1) continue;
        const hue = 262 + cellAge[col][row] * 2;
        const lightness = 48 + Math.min(cellAge[col][row] * 2, 28);
        ctx.fillStyle = `hsla(${hue}, 88%, ${lightness}%, 0.62)`;
        ctx.fillRect(col * resolution, row * resolution, resolution, resolution);
      }
    }

    for (let index = userSparks.length - 1; index >= 0; index -= 1) {
      const spark = userSparks[index];
      spark.life -= 1;
      if (spark.life <= 0) {
        userSparks.splice(index, 1);
        continue;
      }
      const opacity = spark.life / spark.maxLife;
      ctx.fillStyle = `hsla(42, 100%, 72%, ${opacity})`;
      ctx.fillRect(spark.x * resolution, spark.y * resolution, resolution, resolution);
    }
  }

  function gameLoop() {
    if (!isAnimating) return;
    grid = computeNextGeneration();
    drawGrid();
    window.setTimeout(() => {
      animationFrameId = window.requestAnimationFrame(gameLoop);
    }, 250);
  }

  function restartAnimation() {
    if (animationFrameId) window.cancelAnimationFrame(animationFrameId);
    setupGrid();
    randomizeGrid();
    drawGrid();
    if (isAnimating) gameLoop();
  }

  restartAnimation();

  let resizeTimeout;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimeout);
    resizeTimeout = window.setTimeout(restartAnimation, 250);
  });

  document.addEventListener("visibilitychange", () => {
    isAnimating = !document.hidden && !prefersReducedMotion;
    if (isAnimating) gameLoop();
  });

  heroSection.addEventListener("click", (event) => {
    if (event.target.closest("a")) return;
    const rect = canvas.getBoundingClientRect();
    const col = Math.floor((event.clientX - rect.left) / resolution);
    const row = Math.floor((event.clientY - rect.top) / resolution);
    userSparks.push({ x: col, y: row, life: 50, maxLife: 50 });
  });

  window.addEventListener("mousemove", (event) => {
    if (prefersReducedMotion) return;
    const x = (event.clientX / window.innerWidth - 0.5) * 28;
    const y = (event.clientY / window.innerHeight - 0.5) * 28;
    heroContent.style.transform = `translate(${-x}px, ${-y}px)`;
  });

  window.addEventListener("beforeunload", () => {
    if (animationFrameId) window.cancelAnimationFrame(animationFrameId);
  });
});
