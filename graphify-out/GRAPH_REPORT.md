# Graph Report - tamagochi Tver  (2026-10-27)

## Corpus Check
- 133 files · ~125,909 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 8 file(s) not represented in the graph (top: .css 4, (none) 2, .graphify-bak 1)

## Summary
- 1547 nodes · 2627 edges · 128 communities (117 shown, 11 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 68 edges (avg confidence: 0.92)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `2f796ffd`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- settings.json
- render_sprites.py
- rg/main.ts
- Collision Detection
- 2D Maze Game Template
- package.json
- Part 1: Basics
- setup-assets.sh
- setup.sh
- Game Engine Core Design Principles
- filter-test-output.sh
- run.sh
- Game Development Basics
- Game Promotion
- Programming and Technical Terms
- Game Design Terms
- overridesTab.ts
- Экономия лимитов Claude Code
- Other Control Mechanisms
- Game Engine Skill
- Тамагочи отделов продаж — план реализации
- Art and Visual Terms
- Platform and Distribution Terms
- PowerSaver
- Find Skills
- compilerOptions
- Открытые ассеты для игр и как их забирать в Claude Code
- Game feel (juice)
- Тамагочи отделов продаж — дизайн
- Mathematical / Algorithmic Concepts
- 2D Platform Game Template
- General Development Terms
- Audio for Web Games
- Tilemaps
- Game Genre Terms
- Проект: Питомцы отделов продаж
- Blender: модели и спрайты
- Paddle Game Template (2D Breakout)
- Step 2: Move the Ball
- Mathematical / Algorithmic Concepts
- 2D Collision Detection
- Crisp Pixel Art Look
- Step 8: Track the Score and Win
- Step 1: Create the Canvas and Draw on It
- Step 4: Paddle and Keyboard Controls
- Babylon.js
- mock-backend.mjs
- check-render.mjs
- Mathematical / Algorithmic Concepts
- Game Development Terminology
- WebVR API (Deprecated)
- errorText
- WebGL API
- Feedback recipes — depth for `game-feel`
- Web Application Testing
- FakeSheet
- Архитектура игры
- funnel.ts
- gas-harness.mjs
- Game Development Algorithms
- Game Development Techniques
- Web APIs for Game Development
- WebSockets API
- Web Workers API
- WebRTC API
- appsscript.json
- Ассеты для игры
- Win Condition
- Walking Enemies
- Switching Levels
- Step 10: Finishing Up
- Step 3: Bounce Off the Walls
- Step 6: Build the Brick Field
- WebXR
- GLSL Shaders
- Mathematical / Algorithmic Concepts
- Bresenham's Line Algorithm -- Raycasting, Line of Sight, and Pathfinding
- Collision Detection and Response Systems
- WebRTC Data Channels
- Optimizing Startup Performance
- asm.js
- h
- Fullscreen API
- Gamepad API
- Pointer Lock API
- Typed Arrays
- Web Audio API
- Asset kit для Claude Code
- Death
- Animations for the Main Character
- Scoreboard
- Pickable Coins
- Step 7: Collision Detection
- Controls: Gamepad API
- IndexedDB API
- JavaScript
- SVG (Scalable Vector Graphics)
- blender
- Moving Sprites with Physics
- Initialise Phaser
- Moving Forward
- Start Here
- make-art.mjs
- Vector Mathematics for Game Development
- Gravity
- scripts
- CLAUDE.assets.md
- .claude/CLAUDE.md
- CREDITS.md
- A-Frame
- Three.js
- 3D Web Games
- 3D Theory and Fundamentals
- check-admin.mjs
- Keyboard Controls
- Step 9: Mouse Controls
- staffTab.ts
- serverToday
- Bounding Spheres
- PetView.ts
- normsTab.ts
- api.ts
- paint
- ctx.ts

## God Nodes (most connected - your core abstractions)
1. `GroupCode` - 44 edges
2. `DateStr` - 40 edges
3. `vitest` - 31 edges
4. `h()` - 31 edges
5. `Programming and Technical Terms` - 29 edges
6. `Game Design Terms` - 28 edges
7. `errorText()` - 26 edges
8. `Snapshot` - 22 edges
9. `main()` - 22 edges
10. `Employee` - 21 edges

## Surprising Connections (you probably didn't know these)
- `Контракты движка к данным` --references--> `parseDate()`  [INFERRED]
  PLAN.md → src/engine/calendar.ts
- `Task 7: Демо-данные и сценарий` --references--> `simulate()`  [INFERRED]
  docs/superpowers/plans/2026-10-25-tamagochi-plan.md → src/engine/pet.ts
- `Task 6: Рейтинги` --references--> `countsInRating()`  [INFERRED]
  docs/superpowers/plans/2026-10-25-tamagochi-plan.md → src/engine/staff.ts
- ``src/game/Game.hx` -- Game Process` --references--> `Level`  [INFERRED]
  .claude/skills/game-engine/assets/gameBase-template-repo.md → src/engine/types.ts
- `Task 17: Страница РГ` --references--> `use()`  [INFERRED]
  docs/superpowers/plans/2026-10-25-tamagochi-plan.md → src/rg/main.ts

## Import Cycles
- None detected.

## Communities (128 total, 11 thin omitted)

### Community 0 - "settings.json"
Cohesion: 0.11
Nodes (17): advisorModel, autoCompactWindow, effortLevel, enabledPlugins, andrej-karpathy-skills@karpathy-skills, claude-md-management@claude-plugins-official, code-simplifier@claude-plugins-official, frontend-design@claude-plugins-official (+9 more)

### Community 1 - "render_sprites.py"
Cohesion: 0.08
Nodes (24): is_server_ready(), main(), main(), action_fcurves(), armature_actions(), assign_action(), emit(), ensure_object_mode() (+16 more)

### Community 2 - "rg/main.ts"
Cohesion: 0.13
Nodes (12): Attr, Child, TabItem, createSession(), Post, setup(), api, ApiError (+4 more)

### Community 3 - "Collision Detection"
Cohesion: 0.18
Nodes (11): AABB vs. AABB, Axis-Aligned Bounding Boxes (AABB), BoxHelper for Visual Debugging, Collision Detection, Collision Detection with Three.js, Creating Bounding Volumes, Intersection Tests, Physics Engines (+3 more)

### Community 4 - "2D Maze Game Template"
Cohesion: 0.06
Nodes (33): 2D Maze Game Template, Audio System, Ball Creation and Physics, Boot State, Building Levels, Collision Detection, Complete Update Loop, Core Game Mechanics (+25 more)

### Community 5 - "package.json"
Cohesion: 0.15
Nodes (15): dependencies, xlsx@https://cdn.sheetjs.com/xlsx-0.20.3/x..., devDependencies, playwright-core@^1.64.1, @types/node@^26.6.5, typescript@^7.0.2, vite@^8.3.5, vitest@^5.0.5 (+7 more)

### Community 6 - "Part 1: Basics"
Cohesion: 0.06
Nodes (30): Axis Separation, Basic Entity Template, Cell Overflow, Collision Edge Cases and Solutions, Collision Philosophy, Complete Entity with Collisions, Converting to Pixel Coordinates, Coordinate System Diagram (+22 more)

### Community 7 - "setup-assets.sh"
Cohesion: 0.70
Nodes (4): find_blender(), need(), run(), setup-assets.sh script

### Community 8 - "setup.sh"
Cohesion: 0.83
Nodes (3): need(), run(), setup.sh script

### Community 9 - "Game Engine Core Design Principles"
Cohesion: 0.07
Nodes (29): Avoid Premature Abstraction, Batch Operations, Benefits of ECS, Core Concepts, Core Design Principles, Core Engine Subsystems, Data-Driven Design, Data-Oriented Design (+21 more)

### Community 12 - "Game Development Basics"
Cohesion: 0.07
Nodes (28): Advantages of Web-Based Game Development, Alternative Architecture Patterns, Anatomy of a Game Loop, Audio, Basic Main Loop, Building a Game Loop with requestAnimationFrame, Comparison of Timing Approaches, Data Storage and Performance (+20 more)

### Community 13 - "Game Promotion"
Cohesion: 0.07
Nodes (28): Advertisements, Branding and Custom Work, Community Building, Competitions, Events, Freemium, Game Distribution, Game Monetization (+20 more)

### Community 14 - "Programming and Technical Terms"
Cohesion: 0.07
Nodes (29): API (Application Programming Interface), Client-Server Architecture, Collision Detection, Delta Time, Draw Call, Frame Rate (FPS -- Frames Per Second), Frustum Culling, Game Engine (+21 more)

### Community 15 - "Game Design Terms"
Cohesion: 0.07
Nodes (28): Aggro, AoE (Area of Effect), Balancing, Buff / Debuff, Cooldown, Difficulty Curve, DPS (Damage Per Second), Game Design Document (GDD) (+20 more)

### Community 16 - "overridesTab.ts"
Cohesion: 0.31
Nodes (11): ruDate(), overrideDelta(), OverrideKind, parseAmount(), splitDelta(), KIND_TITLE, KINDS, overridesTab() (+3 more)

### Community 17 - "Экономия лимитов Claude Code"
Cohesion: 0.09
Nodes (22): f(), Готовые настройки, Готовый набор для проекта, Граф знаний: graphify, Для игр, Источники, Качество без перерасхода, Коротко (+14 more)

### Community 18 - "Other Control Mechanisms"
Cohesion: 0.10
Nodes (19): Best Practices, Best Practices, Best Practices, Code Examples, Code Examples, Code Examples, Desktop with Gamepad, Desktop with Mouse and Keyboard (+11 more)

### Community 19 - "Game Engine Skill"
Cohesion: 0.12
Nodes (16): Audio, Building a 3D Game, Controls, Core Concepts, Creating a Basic 2D Game, Game Engine Skill, Game Loop, Game Templates (+8 more)

### Community 20 - "Тамагочи отделов продаж — план реализации"
Cohesion: 0.08
Nodes (23): Global Constraints, Review Focus, Task 10: Парсер файла оплат, Task 11: Парсер воронки, Task 12: Бэкенд Apps Script (хранилище + PIN), Task 13: Клиент данных (api + store), Task 14: Экран на живых данных + рейтинги, Task 15: Админка — вход, оплаты, импорт (+15 more)

### Community 21 - "Art and Visual Terms"
Cohesion: 0.13
Nodes (15): Anti-Aliasing, Art and Visual Terms, Asset, Keyframe Animation, Mesh, Normal Map, Parallax Scrolling, Particle System (+7 more)

### Community 22 - "Platform and Distribution Terms"
Cohesion: 0.13
Nodes (15): Bug, Cross-Platform, Day One Patch, DLC (Downloadable Content), Early Access, Exploit, Free-to-Play (F2P), Games as a Service (GaaS) (+7 more)

### Community 23 - "PowerSaver"
Cohesion: 0.06
Nodes (27): Code Example, Events, Key Methods, Key Properties, Note on Fetch API, What It Is, Why It Matters for Games, XMLHttpRequest (+19 more)

### Community 24 - "Find Skills"
Cohesion: 0.14
Nodes (13): Common Skill Categories, Find Skills, How to Help Users Find Skills, Step 1: Understand What They Need, Step 2: Check the Leaderboard First, Step 3: Search for Skills, Step 4: Verify Quality Before Recommending, Step 5: Present Options to the User (+5 more)

### Community 25 - "compilerOptions"
Cohesion: 0.14
Nodes (13): compilerOptions, isolatedModules, lib, module, moduleResolution, noEmit, noUnusedLocals, noUnusedParameters (+5 more)

### Community 26 - "Открытые ассеты для игр и как их забирать в Claude Code"
Cohesion: 0.14
Nodes (13): Библиотеки 2D, Библиотеки 3D, Звук, шрифты, палитры, Как Claude Code должен забирать ассеты, Как работать с Blender MCP и не жечь лимиты, Каким должен быть результат, Коротко, Открытые ассеты для игр и как их забирать в Claude Code (+5 more)

### Community 27 - "Game feel (juice)"
Cohesion: 0.15
Nodes (12): 1. Screen shake by decaying "trauma" (smooth, not a random jitter), 2. Hit-stop / freeze frame (sell impact by briefly stopping time), 3. Squash & stretch + overshoot via an eased tween (the "pop"), 4. A feedback bundle scaled by importance (keep juice proportional), Core principle: feedback is layered and exaggerated, Core workflow, Game feel (juice), Patterns (+4 more)

### Community 28 - "Тамагочи отделов продаж — дизайн"
Cohesion: 0.15
Nodes (12): 1. Зачем, 2. Площадка и стек (мои решения, не согласованы), 3. Роли и доступ, 4. Правила игры (решения заказчика), 5. Интерфейс и стиль, 6. Данные, 7. Оставлено сборщику, 7а. Решения после проверки сборщиком (мои, отмечены как мои) (+4 more)

### Community 29 - "Mathematical / Algorithmic Concepts"
Cohesion: 0.17
Nodes (12): Cross Product (3D), Dot Product, Magnitude (Length), Mathematical / Algorithmic Concepts, Normalization, Perpendicular Vector (2D), Projection, Reflection (+4 more)

### Community 30 - "2D Platform Game Template"
Cohesion: 0.18
Nodes (10): 2D Platform Game Template, Adding a Jump Sound Effect, Creating Platforms, Implementing the Jump Mechanic, Jumps, Loading Platform Assets, Loading the Hero Image, Spawning Platforms from Level Data (+2 more)

### Community 31 - "General Development Terms"
Cohesion: 0.18
Nodes (11): AAA (Triple-A), Alpha, Beta, Build, Crunch, General Development Terms, Gold / Gone Gold, Indie (+3 more)

### Community 32 - "Audio for Web Games"
Cohesion: 0.20
Nodes (10): Audio for Web Games, Decision Matrix, How It Works, Key Challenges on Mobile, Technique 1: Audio Sprites, Technique 2: Web Audio API Multi-Track Music, Technique 3: Beat-Synchronized Track Playback, Technique 4: Positional Audio (3D Spatialization) (+2 more)

### Community 33 - "Tilemaps"
Cohesion: 0.20
Nodes (10): How It Works, Layers, Logic Grid, Performance Optimization, Rendering Static Tilemaps, Scrolling Tilemaps with Camera, Tilemap Types, Tilemaps (+2 more)

### Community 34 - "Game Genre Terms"
Cohesion: 0.20
Nodes (10): Battle Royale, FPS (First-Person Shooter), Game Genre Terms, Metroidvania, MMORPG (Massively Multiplayer Online RPG), MOBA (Multiplayer Online Battle Arena), RPG (Role-Playing Game), RTS (Real-Time Strategy) (+2 more)

### Community 35 - "Проект: Питомцы отделов продаж"
Cohesion: 0.22
Nodes (8): Compact instructions, graphify, Ассеты и Blender, Как работаем, Качество, Команды, Проект: Питомцы отделов продаж, Экономия контекста

### Community 36 - "Blender: модели и спрайты"
Cohesion: 0.22
Nodes (8): Blender: модели и спрайты, Безопасность, Главное правило экономии, Не делай в Blender с нуля то, что можно взять, Перед словом «готово» (частые ошибки — проверять всегда), Порядок работы с MCP (сервер mcp-for-blender), Стандарт готовой модели (проверяет check_asset.py), Стандарт спрайтов (делает render_sprites.py)

### Community 37 - "Paddle Game Template (2D Breakout)"
Cohesion: 0.22
Nodes (8): Complete Code for Step 5, Complete Final Game Code, Implementing Game Over and Paddle Collision, Paddle Game Template (2D Breakout), Quick Reference: All Functions, Quick Reference: All Game Variables, Step 5: Game Over, Storing the Interval Reference

### Community 38 - "Step 2: Move the Ball"
Cohesion: 0.22
Nodes (9): Adding Position Variables, Adding Velocity Variables, Clearing the Canvas, Complete Code for Step 2, Creating the Draw Loop, Drawing the Ball, Refactoring Into a Separate drawBall() Function, Step 2: Move the Ball (+1 more)

### Community 39 - "Mathematical / Algorithmic Concepts"
Cohesion: 0.22
Nodes (9): Definitions, Frame-Rate Independence, Mathematical / Algorithmic Concepts, Normalizing Direction, Practical Game Development Applications, Pseudocode -- Complete Movement Update, Updating Position with Velocity, Velocity and Speed (+1 more)

### Community 40 - "2D Collision Detection"
Cohesion: 0.22
Nodes (9): 2D Collision Detection, Algorithm 1: Axis-Aligned Bounding Box (AABB), Algorithm 2: Circle Collision, Algorithm 3: Separating Axis Theorem (SAT), Base Engine Code, Collision Performance: Broad Phase and Narrow Phase, How It Works, What It Is (+1 more)

### Community 41 - "Crisp Pixel Art Look"
Cohesion: 0.22
Nodes (9): Best Practices, Crisp Pixel Art Look, How It Works, Known Limitations, Technique 1: Scaling `<img>` Elements with CSS, Technique 2: Crisp Pixel Art in Canvas, Technique 3: Arbitrary Canvas Scaling with Correction, What It Is (+1 more)

### Community 42 - "Step 8: Track the Score and Win"
Cohesion: 0.25
Nodes (8): Adding the Win Condition, Calling drawScore() in the Game Loop, Canvas Text Methods Reference, Complete collisionDetection() with Score and Win, Incrementing the Score, Initializing the Score, Step 8: Track the Score and Win, The drawScore() Function

### Community 43 - "Step 1: Create the Canvas and Draw on It"
Cohesion: 0.09
Nodes (24): Complete Code for Step 1, Drawing a Circle, Drawing a Filled Rectangle, Drawing a Stroked Rectangle (Outline Only), Getting the Canvas Reference and 2D Context, HTML Structure, Key Methods Reference, Step 1: Create the Canvas and Draw on It (+16 more)

### Community 44 - "Step 4: Paddle and Keyboard Controls"
Cohesion: 0.25
Nodes (8): Complete Code for Step 4, Defining Paddle Variables, Drawing the Paddle, Event Listeners for Key Presses, Key Handler Functions, Keyboard State Variables, Paddle Movement Logic (With Boundary Checking), Step 4: Paddle and Keyboard Controls

### Community 45 - "Babylon.js"
Cohesion: 0.25
Nodes (8): Babylon.js, Camera and Lighting, Creating Meshes, Engine, Scene, and Render Loop, Materials, Practical Tips, Setup, Transforms and Animation

### Community 46 - "mock-backend.mjs"
Cohesion: 0.13
Nodes (14): Бэкенд: Google Apps Script + Google Sheets, Действия (`POST`, тело JSON, заголовок `text/plain`), Ограничения и договорённости, Развёртывание (делает человек, один раз), Тесты и мок, Что публично, demo, scenario() (+6 more)

### Community 47 - "check-render.mjs"
Cohesion: 0.21
Nodes (8): vite, browserPath, check(), checkStates(), EXPECTED, failures, { port }, SR1_RANKING

### Community 48 - "Mathematical / Algorithmic Concepts"
Cohesion: 0.25
Nodes (8): Collision Detection Pipeline, Collision Resolution with Impulses, Force Accumulation, Integration Methods, Mathematical / Algorithmic Concepts, Rigid Body Properties, Rotational Dynamics, The Physics Loop

### Community 49 - "Game Development Terminology"
Cohesion: 0.25
Nodes (7): Adaptive Audio / Dynamic Music, Audio Terms, BGM (Background Music), FMOD / Wwise, Game Development Terminology, SFX (Sound Effects), Spatial Audio / 3D Audio

### Community 50 - "WebVR API (Deprecated)"
Cohesion: 0.25
Nodes (8): Code Example, Deprecation Notice, Key Events, Key Interfaces, Migration to WebXR, WebVR API (Deprecated), What It Is, Why It Matters for Games

### Community 51 - "errorText"
Cohesion: 0.25
Nodes (14): errorText(), select(), planPaymentsImport(), fileBlock(), choose(), importError(), importTab(), PaymentsReply (+6 more)

### Community 52 - "WebGL API"
Cohesion: 0.25
Nodes (8): Code Example, Context Management Events, Key Interfaces, Recommended Libraries, WebGL 2 Features Important for Games, WebGL API, What It Is, Why It Matters for Games

### Community 53 - "Feedback recipes — depth for `game-feel`"
Cohesion: 0.25
Nodes (7): 1. The trauma model (why shake feels good), 2. Easing cheat sheet — which curve for which job, 3. The rest of the feedback menu, 4. Importance tiers (keep the whole game proportional), 5. Accessibility (ship these toggles), 6. Per-engine binding summary, Feedback recipes — depth for `game-feel`

### Community 54 - "Web Application Testing"
Cohesion: 0.25
Nodes (7): Best Practices, Common Pitfall, Decision Tree: Choosing Your Approach, Example: Using with_server.py, Reconnaissance-Then-Action Pattern, Reference Files, Web Application Testing

### Community 56 - "Архитектура игры"
Cohesion: 0.29
Nodes (6): Архитектура игры, Ассеты, Главный цикл и сцены, Папки, Соглашения, Стек

### Community 57 - "funnel.ts"
Cohesion: 0.11
Nodes (36): xlsx, FunnelFixtureGroup, funnelXlsx(), paymentLine(), PAYMENTS_HEADER, paymentsGrid(), paymentsXlsx(), serialOf() (+28 more)

### Community 58 - "gas-harness.mjs"
Cohesion: 0.18
Nodes (10): admin(), GROUP_CODES, STAFF, withGroups(), withStaff(), CODE_PATH, formatDate(), loadBackend() (+2 more)

### Community 59 - "Game Development Algorithms"
Cohesion: 0.29
Nodes (6): Game Development Algorithms, Physics Engine Fundamentals, Practical Game Development Applications, Pseudocode -- Complete Physics Step, Quick Reference Table, What It Is

### Community 60 - "Game Development Techniques"
Cohesion: 0.29
Nodes (6): Async Scripts, Code Examples, Game Development Techniques, How It Works, What It Is, When to Use It

### Community 61 - "Web APIs for Game Development"
Cohesion: 0.29
Nodes (6): Code Example, CSS (Cascading Style Sheets), Key Properties for Games, Web APIs for Game Development, What It Is, Why It Matters for Games

### Community 62 - "WebSockets API"
Cohesion: 0.25
Nodes (8): Code Example, Events, Key Interface: WebSocket, Notes, WebSockets API, What It Is, Why It Matters for Games, close()

### Community 63 - "Web Workers API"
Cohesion: 0.29
Nodes (7): Code Example, Key Interfaces, Limitations, Web Workers API, What It Is, Why It Matters for Games, Worker Types

### Community 64 - "WebRTC API"
Cohesion: 0.29
Nodes (7): Code Example, Connection Lifecycle, Key Events, Key Interfaces, WebRTC API, What It Is, Why It Matters for Games

### Community 65 - "appsscript.json"
Cohesion: 0.25
Nodes (7): dependencies, exceptionLogging, runtimeVersion, timeZone, webapp, access, executeAs

### Community 66 - "Ассеты для игры"
Cohesion: 0.33
Nodes (5): Ассеты для игры, Где что брать, Лицензии, Порядок поиска, от дешёвого к дорогому, Экономия контекста

### Community 67 - "Win Condition"
Cohesion: 0.33
Nodes (6): Collecting the Key and Opening the Door, Key and Door Callbacks, Loading Door and Key Assets, Showing the Key Icon in the HUD, Spawning the Door and Key, Win Condition

### Community 68 - "Walking Enemies"
Cohesion: 0.33
Nodes (6): Creating Invisible Walls on Platforms, Loading Enemy Assets, Making Spiders Bounce Off Walls, Spawning and Animating Spiders, Spawning Enemies, Walking Enemies

### Community 69 - "Switching Levels"
Cohesion: 0.40
Nodes (6): Level Transition Flow, Loading Level Data Dynamically, Passing Level Number Through init, Starting the Game at Level 0, Switching Levels, data()

### Community 70 - "Step 10: Finishing Up"
Cohesion: 0.33
Nodes (6): Adding the Lives Variable, Calling drawLives() in the Game Loop, Implementing the Lives System, Step 10: Finishing Up, The drawLives() Function, Upgrading to requestAnimationFrame

### Community 71 - "Step 3: Bounce Off the Walls"
Cohesion: 0.33
Nodes (6): Basic Wall Collision (Without Radius Adjustment), Collision Detection Conditions, Complete Code for Step 3, Defining the Ball Radius, Improved Collision (Accounting for Ball Radius), Step 3: Bounce Off the Walls

### Community 72 - "Step 6: Build the Brick Field"
Cohesion: 0.33
Nodes (6): Brick Configuration Variables, Calling drawBricks() in the Game Loop, Complete Code for Step 6, Creating the Bricks 2D Array, Step 6: Build the Brick Field, The drawBricks() Function

### Community 73 - "WebXR"
Cohesion: 0.25
Nodes (8): Core Concepts, Design Principles, Framework Support, Practical Tips, Related APIs, Supported Devices, WebXR, What WebXR Is

### Community 74 - "GLSL Shaders"
Cohesion: 0.25
Nodes (8): Fragment Shader, GLSL Shaders, Key Concepts, Practical Tips, The Shader Pipeline, Using Shaders in HTML and Three.js, Vertex Shader, What Shaders Are

### Community 75 - "Mathematical / Algorithmic Concepts"
Cohesion: 0.33
Nodes (6): AABB vs AABB Overlap Test, Bounding Shapes, Circle vs Circle Overlap Test, Mathematical / Algorithmic Concepts, Separating Axis Theorem (SAT), Sweep and Prune (Broad Phase)

### Community 76 - "Bresenham's Line Algorithm -- Raycasting, Line of Sight, and Pathfinding"
Cohesion: 0.33
Nodes (6): Bresenham's Line Algorithm -- Raycasting, Line of Sight, and Pathfinding, Haxe Implementation (from source), Mathematical / Algorithmic Concepts, Practical Game Development Applications, Pseudocode, What It Is

### Community 77 - "Collision Detection and Response Systems"
Cohesion: 0.33
Nodes (6): Collision Detection and Response Systems, Minimum Penetration Vector (for AABBs), Practical Game Development Applications, Pseudocode -- Collision Detection and Resolution, Spatial Partitioning Strategies, What It Is

### Community 78 - "WebRTC Data Channels"
Cohesion: 0.33
Nodes (6): How It Works, Implementation Notes, Use Cases in Games, WebRTC Data Channels, What It Is, When to Use It

### Community 79 - "Optimizing Startup Performance"
Cohesion: 0.33
Nodes (6): How It Works, Key Techniques, Optimizing Startup Performance, Performance Targets, What It Is, When to Use It

### Community 80 - "asm.js"
Cohesion: 0.33
Nodes (6): asm.js, Code Example, Deprecation Notice, Key Concepts, What It Is, Why It Matters for Games

### Community 81 - "h"
Cohesion: 0.36
Nodes (11): h(), tabs(), ctx, session, showLogin(), showWork(), normsTab(), pinsTab() (+3 more)

### Community 82 - "Fullscreen API"
Cohesion: 0.33
Nodes (6): Code Example, Fullscreen API, Key Interfaces and Methods, Notes, What It Is, Why It Matters for Games

### Community 83 - "Gamepad API"
Cohesion: 0.33
Nodes (6): Code Example, Gamepad API, Key Interfaces, Key Methods and Events, What It Is, Why It Matters for Games

### Community 84 - "Pointer Lock API"
Cohesion: 0.33
Nodes (6): Code Example, Key Interfaces and Methods, Notes, Pointer Lock API, What It Is, Why It Matters for Games

### Community 85 - "Typed Arrays"
Cohesion: 0.33
Nodes (6): Code Example, Key Properties and Methods, Key Types, Typed Arrays, What They Are, Why They Matter for Games

### Community 86 - "Web Audio API"
Cohesion: 0.33
Nodes (6): Code Example, Common Routing Patterns, Key Interfaces, Web Audio API, What It Is, Why It Matters for Games

### Community 87 - "Asset kit для Claude Code"
Cohesion: 0.33
Nodes (5): Asset kit для Claude Code, Проверено, Типовой путь «персонаж → игра», Установка (10 минут), Что внутри

### Community 88 - "Death"
Cohesion: 0.40
Nodes (5): Add Stomp Sound, Adding a Death Animation for the Hero, Death, Guarding Input When Dead, Hero vs Enemy: Stomp or Die

### Community 89 - "Animations for the Main Character"
Cohesion: 0.40
Nodes (5): Animations for the Main Character, Defining Animations, Flipping the Sprite Based on Direction, Loading the Hero Spritesheet, Playing the Correct Animation

### Community 90 - "Scoreboard"
Cohesion: 0.40
Nodes (5): Calling createHud in create, Creating the HUD, Loading the Bitmap Font, Scoreboard, Updating the Score Display

### Community 91 - "Pickable Coins"
Cohesion: 0.40
Nodes (5): Collecting Coins, Initializing the Coin Counter, Loading Coin Assets, Pickable Coins, Spawning Coins from Level Data

### Community 92 - "Step 7: Collision Detection"
Cohesion: 0.40
Nodes (5): Adding the Status Property to Bricks, Calling collisionDetection() in the Game Loop, Step 7: Collision Detection, The collisionDetection() Function, Updating drawBricks() to Respect Status

### Community 93 - "Controls: Gamepad API"
Cohesion: 0.40
Nodes (5): Code Examples, Controls: Gamepad API, How It Works, What It Is, When to Use It

### Community 94 - "IndexedDB API"
Cohesion: 0.40
Nodes (5): Code Example, IndexedDB API, Key Interfaces, What It Is, Why It Matters for Games

### Community 95 - "JavaScript"
Cohesion: 0.40
Nodes (5): Code Example, JavaScript, Key Language Features for Games, What It Is, Why It Matters for Games

### Community 96 - "SVG (Scalable Vector Graphics)"
Cohesion: 0.40
Nodes (5): Code Example, Key Elements, SVG (Scalable Vector Graphics), What It Is, Why It Matters for Games

### Community 97 - "blender"
Cohesion: 0.40
Nodes (4): DISABLE_TELEMETRY, uvx, blender, mcp-for-blender

### Community 98 - "Moving Sprites with Physics"
Cohesion: 0.50
Nodes (4): Adding a Physics Body to the Hero, Enabling the Physics Engine, Moving Sprites with Physics, Moving with Velocity

### Community 99 - "Initialise Phaser"
Cohesion: 0.50
Nodes (4): Creating the Game Instance, HTML Entry Point, Initialise Phaser, The PlayState Object

### Community 100 - "Moving Forward"
Cohesion: 0.50
Nodes (4): Full Game Source Reference, Key Concepts Summary, Moving Forward, Suggested Improvements

### Community 101 - "Start Here"
Cohesion: 0.50
Nodes (4): Level Data Format, Project Structure, Start Here, What You Will Build

### Community 102 - "make-art.mjs"
Cohesion: 0.38
Nodes (4): egg(), EGGS, rng(), svg()

### Community 103 - "Vector Mathematics for Game Development"
Cohesion: 0.50
Nodes (4): Practical Game Development Applications, Pseudocode -- Vector2D Class, Vector Mathematics for Game Development, What It Is

### Community 104 - "Gravity"
Cohesion: 0.67
Nodes (3): Collision Detection Between Hero and Platforms, Gravity, Setting Global Gravity

### Community 105 - "scripts"
Cohesion: 0.29
Nodes (7): scripts, build, check:admin, check:render, dev, mock-backend, test

### Community 113 - "A-Frame"
Cohesion: 0.29
Nodes (7): A-Frame, Animation, Camera and Lighting, Creating Entities with JavaScript, Practical Tips, Primitives and Entities, Setup

### Community 114 - "Three.js"
Cohesion: 0.29
Nodes (7): Animation Loop, Core Components, Geometry, Material, and Mesh, Lighting, Practical Tips, Setup, Three.js

### Community 115 - "3D Web Games"
Cohesion: 0.33
Nodes (5): 3D Web Games, Frameworks, Key Features, PlayCanvas, Practical Tips

### Community 116 - "3D Theory and Fundamentals"
Cohesion: 0.33
Nodes (6): 3D Theory and Fundamentals, Camera, Coordinate System, Practical Tips, The Rendering Pipeline, Vertices, Edges, Faces, and Meshes

### Community 117 - "check-admin.mjs"
Cohesion: 0.18
Nodes (6): browserPath, failures, GROUP_CODES, { port }, textOf(), waitForText()

### Community 118 - "Keyboard Controls"
Cohesion: 0.67
Nodes (3): Keyboard Controls, Reading Input in Update, Setting Up Input Keys

### Community 119 - "Step 9: Mouse Controls"
Cohesion: 0.50
Nodes (4): Adding the mousemove Event Listener, Complete Event Listener Setup (Keyboard + Mouse), Step 9: Mouse Controls, The mouseMoveHandler Function

### Community 120 - "staffTab.ts"
Cohesion: 0.15
Nodes (23): AbsenceForm, buildAbsence(), buildStaffPatch(), Failure, filterStaff(), formOf(), JSON_KEYS, KINDS (+15 more)

### Community 121 - "serverToday"
Cohesion: 0.39
Nodes (6): paymentsTab(), save(), provisionalChanges(), provisionalToday(), snapshot, serverToday()

### Community 122 - "Bounding Spheres"
Cohesion: 0.50
Nodes (4): Bounding Spheres, Point vs. Sphere, Sphere vs. AABB, Sphere vs. Sphere

### Community 123 - "PetView.ts"
Cohesion: 0.06
Nodes (36): Loading and Displaying the Background, The Game Loop, Understanding the Frame Cycle, Build Targets, Debug Features, Entity Lifecycle, Game Loop Architecture, GameBase Template Repository (+28 more)

### Community 124 - "normsTab.ts"
Cohesion: 0.14
Nodes (24): ConfigCurrent, ConfigForm, configFormOf(), configPatch(), LEVEL_TITLE, LEVELS, NORM_FIELD_TITLE, Scalar (+16 more)

### Community 125 - "api.ts"
Cohesion: 0.05
Nodes (95): Task 3: Штат и статусы по датам, Task 5: Симуляция питомца, Task 9: Экран с питомцами (рендер), Отложено после обзора (мелочи), vitest, COUNTS, GroupChange, mergeConfig() (+87 more)

### Community 126 - "paint"
Cohesion: 0.33
Nodes (6): configPreview(), describeChange(), differences(), lineOf(), looks(), paint()

## Knowledge Gaps
- **3 isolated node(s):** `uvx`, `mcp-for-blender`, `DISABLE_TELEMETRY`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 961 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **11 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `fill()` connect `Step 1: Create the Canvas and Draw on It` to `api.ts`?**
  _High betweenness centrality (0.093) - this node is a cross-community bridge._
- **What connects `uvx`, `mcp-for-blender`, `DISABLE_TELEMETRY` to the rest of the system?**
  _3 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `settings.json` be split into smaller, more focused modules?**
  _Cohesion score 0.1111111111111111 - nodes in this community are weakly interconnected._
- **Why does `Web APIs for Game Development` connect `Web APIs for Game Development` to `SVG (Scalable Vector Graphics)`, `WebRTC API`, `Step 1: Create the Canvas and Draw on It`, `asm.js`, `Fullscreen API`, `Gamepad API`, `Pointer Lock API`, `Typed Arrays`, `Web Audio API`, `WebGL API`, `WebSockets API`, `WebVR API (Deprecated)`, `PowerSaver`, `Web Workers API`, `IndexedDB API`, `JavaScript`?**
  _High betweenness centrality (0.082) - this node is a cross-community bridge._
- **Should `render_sprites.py` be split into smaller, more focused modules?**
  _Cohesion score 0.0819252432155658 - nodes in this community are weakly interconnected._
- **Why does `Key Methods (CanvasRenderingContext2D)` connect `Step 1: Create the Canvas and Draw on It` to `serverToday`?**
  _High betweenness centrality (0.073) - this node is a cross-community bridge._
- **Should `rg/main.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.12987012987012986 - nodes in this community are weakly interconnected._