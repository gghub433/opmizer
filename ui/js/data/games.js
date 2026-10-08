/* GinN — game catalog: platforms, FPS caps, "potato" / "balanced" setting recipes, fpsLimit().
 * Recipes use the real in-game setting names; {fps} is replaced by the chosen target. */
window.GinN = window.GinN || {};

(function (G) {
  'use strict';

  /*
   * Entry shape (see docs/ARCHITECTURE.md):
   * { id, name, color, glyph,
   *   android: { packages:[…], fpsCap, potato?:'mcpack' } | null,
   *   pc: { match:{ steam?:[appid], epic?:[appName], key?:string }, fpsCap, profile:bool } | null,
   *   recipe: { android?:{ potato:{section:[items]}, balanced:{…} }, pc?:{ potato, balanced } } }
   * fpsCap 1000 = the game has no practical limit.
   */
  var LIST = [
    {
      id: 'minecraft', name: 'Minecraft', color: '#5BA33B', glyph: '⛏️',
      android: { packages: ['com.mojang.minecraftpe'], fpsCap: 144, potato: 'mcpack' },
      pc: { match: { key: 'minecraft-java' }, fpsCap: 1000, profile: true },
      recipe: {
        android: {
          potato: {
            'Настройки → Видео': [
              'Дальность прорисовки: 4–6 чанков',
              'Плавное освещение: выкл.',
              'Красивое небо: выкл.',
              'Красивая листва: выкл.',
              'Отображать облака: выкл.',
              'Покачивание камеры: выкл.'
            ],
            'Текстуры GinN Gray': [
              'Скачай пак и открой файл — Minecraft импортирует его сам',
              'Включи его: Настройки → Глобальные ресурсы → GinN Gray → Активировать',
              'Если FPS всё ещё ниже {fps} — убавь дальность ещё на 2 чанка'
            ]
          },
          balanced: {
            'Настройки → Видео': [
              'Дальность прорисовки: 8–10 чанков',
              'Плавное освещение: вкл.',
              'Красивое небо: вкл.',
              'Красивая листва: выкл.',
              'Отображать облака: вкл.',
              'Если FPS ниже {fps} — убавь дальность на 2 чанка'
            ]
          }
        },
        pc: {
          potato: {
            'Настройки → Настройки графики': [
              'Графика: Быстрая',
              'Дальность прорисовки: 6 чанков',
              'Дальность симуляции: 5 чанков',
              'Плавное освещение: выкл.',
              'Облака: выкл.',
              'Частицы: Минимум',
              'Тени сущностей: выкл.',
              'Смешивание биомов: выкл.'
            ],
            'Кадры и текстуры': [
              'Макс. частота кадров: {fps}',
              'Вертикальная синхронизация: выкл.',
              'Серые текстуры: Пакеты ресурсов → GinN Gray'
            ]
          },
          balanced: {
            'Настройки → Настройки графики': [
              'Графика: Детальная',
              'Дальность прорисовки: 10–12 чанков',
              'Дальность симуляции: 8 чанков',
              'Плавное освещение: вкл.',
              'Облака: Быстрые',
              'Частицы: Уменьшено',
              'Макс. частота кадров: {fps}',
              'Вертикальная синхронизация: выкл.'
            ]
          }
        }
      }
    },
    {
      id: 'roblox', name: 'Roblox', color: '#E2231A', glyph: '🧱',
      android: { packages: ['com.roblox.client'], fpsCap: 60 },
      pc: { match: { key: 'roblox' }, fpsCap: 240, profile: false },
      recipe: {
        android: {
          potato: {
            'Меню → Настройки': [
              'Режим графики: Вручную',
              'Качество графики: 1 деление',
              'Макс. частота кадров: {fps}',
              'В тяжёлых режимах выбирай серверы, где меньше игроков'
            ]
          },
          balanced: {
            'Меню → Настройки': [
              'Режим графики: Вручную',
              'Качество графики: 3–4 деления',
              'Макс. частота кадров: {fps}'
            ]
          }
        },
        pc: {
          potato: {
            'Esc → Настройки': [
              'Режим графики: Вручную',
              'Качество графики: 1–2 деления',
              'Макс. частота кадров: {fps}',
              'Полный экран: вкл. (F11)'
            ]
          },
          balanced: {
            'Esc → Настройки': [
              'Режим графики: Вручную',
              'Качество графики: 5–6 делений',
              'Макс. частота кадров: {fps}',
              'Полный экран: вкл. (F11)'
            ]
          }
        }
      }
    },
    {
      id: 'fortnite', name: 'Fortnite', color: '#9D4DFF', glyph: '🦙',
      android: { packages: ['com.epicgames.fortnite'], fpsCap: 120 },
      pc: { match: { epic: ['Fortnite'] }, fpsCap: 1000, profile: true },
      recipe: {
        android: {
          potato: {
            'Настройки → Видео': [
              'Качество: Низкое',
              'Ограничение частоты кадров: {fps} FPS',
              'Разрешение 3D: 75%',
              'Показывать FPS: вкл. — видно, держится ли {fps}'
            ]
          },
          balanced: {
            'Настройки → Видео': [
              'Качество: Среднее',
              'Ограничение частоты кадров: {fps} FPS',
              'Разрешение 3D: 100%'
            ]
          }
        },
        pc: {
          potato: {
            'Настройки → Видео': [
              'Режим рендеринга: Производительность',
              'Ограничение частоты кадров: {fps} FPS',
              'Вертикальная синхронизация: выкл.',
              'Разрешение 3D: 100%',
              'Дальность прорисовки: Средняя',
              'Текстуры: Низкие',
              'Сетка: Низкая',
              'NVIDIA Reflex: Вкл. + Boost'
            ]
          },
          balanced: {
            'Настройки → Видео': [
              'Режим рендеринга: DirectX 12',
              'Качество: Среднее',
              'Ограничение частоты кадров: {fps} FPS',
              'Вертикальная синхронизация: выкл.',
              'Тени: выкл.',
              'Размытие в движении: выкл.',
              'NVIDIA Reflex: Вкл. + Boost'
            ]
          }
        }
      }
    },
    {
      id: 'pubgm', name: 'PUBG Mobile', color: '#F2A900', glyph: '🪂',
      android: {
        packages: ['com.tencent.ig', 'com.pubg.imobile', 'com.pubg.krmobile', 'com.vng.pubgmobile', 'com.rekoo.pubgm'],
        fpsCap: 120
      },
      pc: null,
      recipe: {
        android: {
          potato: {
            'Настройки → Графика': [
              'Качество графики: Плавная',
              'Частота кадров: самая высокая, но не больше {fps} FPS',
              'Стиль: Классический',
              'Сглаживание: выкл.',
              'Тени: выкл.',
              'Автонастройка графики: выкл.'
            ]
          },
          balanced: {
            'Настройки → Графика': [
              'Качество графики: Сбалансированная',
              'Частота кадров: ближайшая к {fps} FPS',
              'Стиль: Классический',
              'Сглаживание: выкл.',
              'Тени: вкл.',
              'Автонастройка графики: выкл.'
            ]
          }
        }
      }
    },
    {
      id: 'freefire', name: 'Free Fire', color: '#FF6B1A', glyph: '🔥',
      android: { packages: ['com.dts.freefireth', 'com.dts.freefiremax'], fpsCap: 60 },
      pc: null,
      recipe: {
        android: {
          potato: {
            'Настройки → Графика': [
              'Графика: Плавная',
              'Высокий FPS: вкл.',
              'Тени: выкл.',
              'Высокое разрешение: выкл.',
              'Цель — ровные {fps} FPS без просадок'
            ]
          },
          balanced: {
            'Настройки → Графика': [
              'Графика: Стандартная',
              'Высокий FPS: вкл.',
              'Тени: выкл.',
              'Высокое разрешение: выкл.',
              'Если FPS ниже {fps} — верни графику «Плавная»'
            ]
          }
        }
      }
    },
    {
      id: 'codm', name: 'Call of Duty: Mobile', color: '#C8A24A', glyph: '🎖️',
      android: { packages: ['com.activision.callofduty.shooter', 'com.garena.game.codm'], fpsCap: 120 },
      pc: null,
      recipe: {
        android: {
          potato: {
            'Настройки → Графика': [
              'Качество графики: Низкое',
              'Частота кадров: самая высокая, но не больше {fps} FPS',
              'Глубина резкости: выкл.',
              'Блум: выкл.',
              'Тени в реальном времени: выкл.',
              'Рэгдолл: выкл.',
              'Сглаживание: выкл.'
            ]
          },
          balanced: {
            'Настройки → Графика': [
              'Качество графики: Среднее',
              'Частота кадров: ближайшая к {fps} FPS',
              'Глубина резкости: выкл.',
              'Блум: выкл.',
              'Тени в реальном времени: вкл.',
              'Рэгдолл: выкл.'
            ]
          }
        }
      }
    },
    {
      id: 'standoff2', name: 'Standoff 2', color: '#F97316', glyph: '🔫',
      android: { packages: ['com.axlebolt.standoff2'], fpsCap: 120 },
      pc: null,
      recipe: {
        android: {
          potato: {
            'Настройки → Графика': [
              'Качество графики: Низкое',
              'Лимит FPS: {fps}',
              'Не играй на зарядке — телефон греется и сбрасывает частоту'
            ]
          },
          balanced: {
            'Настройки → Графика': [
              'Качество графики: Среднее',
              'Лимит FPS: {fps}',
              'Если FPS скачет — опусти качество до «Низкого»'
            ]
          }
        }
      }
    },
    {
      id: 'brawlstars', name: 'Brawl Stars', color: '#FFC20E', glyph: '⭐',
      android: { packages: ['com.supercell.brawlstars'], fpsCap: 60 },
      pc: null,
      recipe: {
        android: {
          potato: {
            'Настройки': [
              'Частота кадров: {fps} FPS',
              'Качество графики: Низкое (если есть на твоём телефоне)',
              'Перед боем жми «Ускорение» в GinN — игре нужна свободная память'
            ]
          },
          balanced: {
            'Настройки': [
              'Частота кадров: {fps} FPS',
              'Качество графики: Высокое',
              'Если телефон греется — верни «Низкое»'
            ]
          }
        }
      }
    },
    {
      id: 'genshin', name: 'Genshin Impact', color: '#D9B36C', glyph: '✨',
      android: { packages: ['com.miHoYo.GenshinImpact'], fpsCap: 60 },
      pc: { match: { key: 'genshin-impact' }, fpsCap: 120, profile: false },
      recipe: {
        android: {
          potato: {
            'Паймон → Настройки → Графика': [
              'Качество графики: Своё',
              'Частота кадров: {fps}',
              'Точность рендеринга: Самая низкая',
              'Качество теней: Самое низкое',
              'Визуальные эффекты: Самые низкие',
              'Качество спецэффектов: Самое низкое',
              'Детализация окружения: Самая низкая',
              'Размытие в движении: выкл.'
            ]
          },
          balanced: {
            'Паймон → Настройки → Графика': [
              'Частота кадров: {fps}',
              'Точность рендеринга: Средняя',
              'Качество теней: Низкое',
              'Визуальные эффекты: Средние',
              'Детализация окружения: Низкая',
              'Размытие в движении: выкл.'
            ]
          }
        },
        pc: {
          potato: {
            'Паймон → Настройки → Графика': [
              'Частота кадров: {fps}',
              'Вертикальная синхронизация: выкл.',
              'Точность рендеринга: 0.8',
              'Качество теней: Самое низкое',
              'Визуальные эффекты: Самые низкие',
              'Детализация окружения: Самая низкая',
              'Сглаживание: выкл.',
              'Объёмный туман, отражения, свечение, размытие: выкл.'
            ]
          },
          balanced: {
            'Паймон → Настройки → Графика': [
              'Частота кадров: {fps}',
              'Вертикальная синхронизация: выкл.',
              'Точность рендеринга: 1.0',
              'Качество теней: Среднее',
              'Визуальные эффекты: Средние',
              'Сглаживание: SMAA',
              'Размытие в движении: выкл.'
            ]
          }
        }
      }
    },
    {
      id: 'hsr', name: 'Honkai: Star Rail', color: '#7B6CF6', glyph: '🚂',
      android: { packages: ['com.HoYoverse.hkrpgoversea'], fpsCap: 60 },
      pc: { match: { key: 'honkai-star-rail' }, fpsCap: 120, profile: false },
      recipe: {
        android: {
          potato: {
            'Телефон → Настройки → Графика': [
              'Качество графики: Очень низкое',
              'Частота кадров: {fps}',
              'Точность рендеринга: 0.8',
              'Качество теней: Выкл.',
              'Качество отражений: Очень низкое',
              'Качество эффектов: Низкое',
              'Сглаживание: выкл.'
            ]
          },
          balanced: {
            'Телефон → Настройки → Графика': [
              'Качество графики: Низкое',
              'Частота кадров: {fps}',
              'Точность рендеринга: 1.0',
              'Качество теней: Низкое',
              'Качество эффектов: Среднее',
              'Сглаживание: выкл.'
            ]
          }
        },
        pc: {
          potato: {
            'Телефон → Настройки → Графика': [
              'Частота кадров: {fps}',
              'Вертикальная синхронизация: выкл.',
              'Точность рендеринга: 0.8',
              'Качество теней: Выкл.',
              'Качество света и отражений: Очень низкое',
              'Сглаживание: выкл.'
            ]
          },
          balanced: {
            'Телефон → Настройки → Графика': [
              'Частота кадров: {fps}',
              'Вертикальная синхронизация: выкл.',
              'Точность рендеринга: 1.0',
              'Качество теней: Среднее',
              'Качество эффектов: Среднее',
              'Сглаживание: TAA'
            ]
          }
        }
      }
    },
    {
      id: 'mlbb', name: 'Mobile Legends', color: '#0EA5E9', glyph: '⚔️',
      android: { packages: ['com.mobile.legends'], fpsCap: 120 },
      pc: null,
      recipe: {
        android: {
          potato: {
            'Настройки → Основные': [
              'Качество графики: Плавно',
              'Высокая частота кадров: вкл. (до {fps} FPS)',
              'Тени: выкл.',
              'Режим HD: выкл.'
            ]
          },
          balanced: {
            'Настройки → Основные': [
              'Качество графики: Высокое',
              'Высокая частота кадров: вкл. (до {fps} FPS)',
              'Тени: выкл.',
              'Режим HD: вкл.'
            ]
          }
        }
      }
    },
    {
      id: 'clashroyale', name: 'Clash Royale', color: '#3B82F6', glyph: '👑',
      android: { packages: ['com.supercell.clashroyale'], fpsCap: 60 },
      pc: null,
      recipe: {
        android: {
          potato: {
            'Что можно сделать': [
              'Настроек графики в игре почти нет — FPS зависит от телефона',
              'Перед боем жми «Ускорение» в GinN',
              'Включи «Не беспокоить», чтобы уведомления не закрывали арену',
              'Цель — ровные {fps} FPS'
            ]
          },
          balanced: {
            'Что можно сделать': [
              'Настроек графики в игре почти нет — FPS зависит от телефона',
              'Выключи экономию заряда на время игры',
              'Цель — ровные {fps} FPS'
            ]
          }
        }
      }
    },
    {
      id: 'amongus', name: 'Among Us', color: '#C51111', glyph: '🚀',
      android: { packages: ['com.innersloth.spacemafia'], fpsCap: 60 },
      pc: null,
      recipe: {
        android: {
          potato: {
            'Что можно сделать': [
              'Игра лёгкая — 60 FPS тянет почти любой телефон',
              'Если тормозит — жми «Ускорение» перед игрой',
              'Цель — ровные {fps} FPS'
            ]
          },
          balanced: {
            'Что можно сделать': [
              'Игра лёгкая — 60 FPS тянет почти любой телефон',
              'Выключи экономию заряда на время игры',
              'Цель — ровные {fps} FPS'
            ]
          }
        }
      }
    },
    {
      id: 'subway', name: 'Subway Surfers', color: '#22C55E', glyph: '🛹',
      android: { packages: ['com.kiloo.subwaysurf'], fpsCap: 60 },
      pc: null,
      recipe: {
        android: {
          potato: {
            'Что можно сделать': [
              'Настроек графики в игре почти нет — FPS зависит от телефона',
              'Жми «Ускорение» перед игрой',
              'Выключи экономию заряда — с ней игра идёт рывками',
              'Цель — ровные {fps} FPS'
            ]
          },
          balanced: {
            'Что можно сделать': [
              'Настроек графики в игре почти нет — FPS зависит от телефона',
              'Выключи экономию заряда на время игры',
              'Цель — ровные {fps} FPS'
            ]
          }
        }
      }
    },
    {
      id: 'asphalt', name: 'Asphalt Legends', color: '#E11D48', glyph: '🏎️',
      android: { packages: ['com.gameloft.android.ANMP.GloftA9HM'], fpsCap: 60 },
      pc: null,
      recipe: {
        android: {
          potato: {
            'Настройки → Графика': [
              'Качество графики: самое низкое («Производительность»)',
              'Частота кадров: {fps}, если игра даёт выбор',
              'Не играй на зарядке — телефон греется и сбрасывает частоту'
            ]
          },
          balanced: {
            'Настройки → Графика': [
              'Качество графики: По умолчанию',
              'Частота кадров: {fps}, если игра даёт выбор',
              'Если телефон греется — опусти качество'
            ]
          }
        }
      }
    },
    {
      id: 'cs2', name: 'Counter-Strike 2', color: '#DE9B35', glyph: '💣',
      android: null,
      pc: { match: { steam: [730] }, fpsCap: 1000, profile: true },
      recipe: {
        pc: {
          potato: {
            'Настройки → Видео → Расширенные': [
              'Сглаживание: CMAA2',
              'Качество глобальных теней: Низкое',
              'Детализация моделей и текстур: Низкая',
              'Фильтрация текстур: Билинейная',
              'Детализация шейдеров: Низкая',
              'Детализация частиц: Низкая',
              'Затенение фонового освещения: Выкл.',
              'Широкий динамический диапазон: Производительность'
            ],
            'Задержка': [
              'Ждать вертикального обновления: Выкл.',
              'NVIDIA Reflex: Вкл. + Boost',
              'Лимит FPS: {fps} (консоль: fps_max {fps})'
            ]
          },
          balanced: {
            'Настройки → Видео → Расширенные': [
              'Сглаживание: 4x MSAA',
              'Качество глобальных теней: Высокое — так лучше видно врагов',
              'Детализация моделей и текстур: Средняя',
              'Фильтрация текстур: Анизотропная 4x',
              'Детализация шейдеров: Низкая',
              'Затенение фонового освещения: Выкл.',
              'FidelityFX Super Resolution: Выкл.'
            ],
            'Задержка': [
              'Ждать вертикального обновления: Выкл.',
              'NVIDIA Reflex: Вкл. + Boost',
              'Лимит FPS: {fps} (консоль: fps_max {fps})'
            ]
          }
        }
      }
    },
    {
      id: 'valorant', name: 'Valorant', color: '#FF4655', glyph: '🎯',
      android: null,
      pc: { match: { key: 'riot:valorant' }, fpsCap: 1000, profile: false },
      recipe: {
        pc: {
          potato: {
            'Настройки → Видео → Общие': [
              'Режим экрана: Полноэкранный',
              'Ограничивать FPS всегда: Вкл. — {fps}',
              'NVIDIA Reflex: Вкл. + Boost'
            ],
            'Видео → Качество графики': [
              'Многопоточный рендеринг: Вкл.',
              'Материалы, текстуры, детализация, интерфейс: Низкое',
              'Виньетирование: Выкл.',
              'Вертикальная синхронизация: Выкл.',
              'Сглаживание: Нет',
              'Анизотропная фильтрация: 1x',
              'Улучшение чёткости, свечение, искажения, тени: Выкл.'
            ]
          },
          balanced: {
            'Настройки → Видео → Общие': [
              'Режим экрана: Полноэкранный',
              'Ограничивать FPS всегда: Вкл. — {fps}',
              'NVIDIA Reflex: Вкл. + Boost'
            ],
            'Видео → Качество графики': [
              'Многопоточный рендеринг: Вкл.',
              'Материалы и текстуры: Среднее',
              'Детализация и интерфейс: Низкое',
              'Вертикальная синхронизация: Выкл.',
              'Сглаживание: MSAA 2x',
              'Анизотропная фильтрация: 4x',
              'Улучшение чёткости: Вкл.'
            ]
          }
        }
      }
    },
    {
      id: 'dota2', name: 'Dota 2', color: '#B8352B', glyph: '🛡️',
      android: null,
      pc: { match: { steam: [570] }, fpsCap: 240, profile: false },
      recipe: {
        pc: {
          potato: {
            'Настройки → Видео': [
              'Качество отрисовки экрана: 70–80%',
              'Текстуры: Низкие',
              'Эффекты: Низкие',
              'Тени: Выкл.',
              'Сглаживание, затенение, трава, туман: выкл.',
              'Вертикальная синхронизация: выкл.',
              'Макс. частота кадров: {fps}'
            ]
          },
          balanced: {
            'Настройки → Видео': [
              'Качество отрисовки экрана: 100%',
              'Текстуры: Высокие',
              'Эффекты: Средние',
              'Тени: Средние',
              'Затенение и туман: выкл.',
              'Вертикальная синхронизация: выкл.',
              'Макс. частота кадров: {fps}'
            ]
          }
        }
      }
    },
    {
      id: 'apex', name: 'Apex Legends', color: '#DA292A', glyph: '🔺',
      android: null,
      pc: { match: { steam: [1172470] }, fpsCap: 300, profile: false },
      recipe: {
        pc: {
          potato: {
            'Настройки → Видео': [
              'Режим экрана: Полноэкранный',
              'Вертикальная синхронизация: Выкл.',
              'NVIDIA Reflex: Вкл. + Boost',
              'Адаптивное разрешение: 0',
              'Сглаживание: Нет',
              'Бюджет текстур: Низкий',
              'Фильтрация текстур: Билинейная',
              'Окружающее затенение и точечные тени: Выкл.'
            ],
            'Лимит FPS': [
              'Steam → Apex Legends → Свойства → Параметры запуска',
              'Впиши: +fps_max {fps}',
              'Если FPS ниже {fps} — снизь детализацию моделей и эффектов'
            ]
          },
          balanced: {
            'Настройки → Видео': [
              'Режим экрана: Полноэкранный',
              'Вертикальная синхронизация: Выкл.',
              'NVIDIA Reflex: Вкл. + Boost',
              'Сглаживание: TSAA',
              'Бюджет текстур: Средний',
              'Фильтрация текстур: Анизотропная 4x',
              'Тени от солнца: Низкие'
            ],
            'Лимит FPS': [
              'Steam → Apex Legends → Свойства → Параметры запуска',
              'Впиши: +fps_max {fps}',
              'Если FPS ниже {fps} — сначала снизь тени'
            ]
          }
        }
      }
    },
    {
      id: 'pubg', name: 'PUBG: Battlegrounds', color: '#E8A33D', glyph: '🍳',
      android: null,
      pc: { match: { steam: [578080] }, fpsCap: 300, profile: false },
      recipe: {
        pc: {
          potato: {
            'Настройки → Графика': [
              'Режим экрана: Полноэкранный',
              'Ограничение FPS: Своё — {fps}',
              'Масштаб рендеринга: 100',
              'Сглаживание: Очень низко',
              'Пост-обработка: Очень низко',
              'Тени: Очень низко',
              'Текстуры: Средне — так лучше видно противников',
              'Эффекты, растительность, дальность: Очень низко'
            ]
          },
          balanced: {
            'Настройки → Графика': [
              'Режим экрана: Полноэкранный',
              'Ограничение FPS: Своё — {fps}',
              'Сглаживание: Высоко',
              'Пост-обработка: Очень низко',
              'Тени: Очень низко',
              'Текстуры: Высоко',
              'Дальность прорисовки: Средне',
              'Вертикальная синхронизация и размытие: выкл.'
            ]
          }
        }
      }
    },
    {
      id: 'gtav', name: 'GTA V', color: '#16A34A', glyph: '🚓',
      android: null,
      pc: { match: { steam: [271590, 3240220] }, fpsCap: 180, profile: false },
      recipe: {
        pc: {
          potato: {
            'Настройки → Графика': [
              'Вертикальная синхронизация: Выкл.',
              'FXAA: Вкл., MSAA: Выкл.',
              'Качество текстур: Нормальное',
              'Качество шейдеров и теней: Нормальное',
              'Отражения и вода: Нормальное',
              'Плотность и разнообразие населения: минимум',
              'Масштаб расстояния: минимум',
              'Трава и частицы: Нормальное'
            ],
            'Лимит FPS': [
              'В игре нет ограничителя — поставь {fps} FPS в панели NVIDIA или AMD',
              'Выше ~180 FPS игра начинает глючить',
              'Режим экрана: Полноэкранный'
            ]
          },
          balanced: {
            'Настройки → Графика': [
              'Вертикальная синхронизация: Выкл.',
              'FXAA: Вкл., MSAA: Выкл.',
              'Качество текстур: Высокое',
              'Качество шейдеров: Высокое',
              'Качество теней: Высокое',
              'Трава: Высокое'
            ],
            'Лимит FPS': [
              'В игре нет ограничителя — поставь {fps} FPS в панели NVIDIA или AMD',
              'Выше ~180 FPS игра начинает глючить',
              'Режим экрана: Полноэкранный'
            ]
          }
        }
      }
    },
    {
      id: 'rust', name: 'Rust', color: '#CD412B', glyph: '🪓',
      android: null,
      pc: { match: { steam: [252490] }, fpsCap: 240, profile: false },
      recipe: {
        pc: {
          potato: {
            'Options → Graphics': [
              'Качество графики (Graphics Quality): 0',
              'Дальность прорисовки (Draw Distance): 1500',
              'Качество теней (Shadow Quality): 0',
              'Каскады теней: без каскадов',
              'Качество воды (Water Quality): 0',
              'Сглаживание (Anti-Aliasing): выкл.',
              'Затенение (Ambient Occlusion): выкл.',
              'Макс. FPS (fps.limit): {fps}'
            ]
          },
          balanced: {
            'Options → Graphics': [
              'Качество графики (Graphics Quality): 3',
              'Дальность прорисовки (Draw Distance): 2500',
              'Качество теней (Shadow Quality): 1',
              'Качество воды (Water Quality): 1',
              'Сглаживание (Anti-Aliasing): SMAA',
              'Затенение (Ambient Occlusion): выкл.',
              'Макс. FPS (fps.limit): {fps}'
            ]
          }
        }
      }
    },
    {
      id: 'overwatch2', name: 'Overwatch 2', color: '#F99E1A', glyph: '🦾',
      android: null,
      pc: { match: { steam: [2357570], key: 'battlenet:overwatch' }, fpsCap: 600, profile: false },
      recipe: {
        pc: {
          potato: {
            'Параметры → Видео': [
              'Режим экрана: Полноэкранный',
              'Ограничение частоты кадров: Своё — {fps}',
              'NVIDIA Reflex: Вкл. + Boost',
              'Вертикальная синхронизация и тройная буферизация: Выкл.',
              'Качество графики: Низкое',
              'Масштаб рендеринга: 100%'
            ]
          },
          balanced: {
            'Параметры → Видео': [
              'Режим экрана: Полноэкранный',
              'Ограничение частоты кадров: Своё — {fps}',
              'NVIDIA Reflex: Вкл. + Boost',
              'Вертикальная синхронизация: Выкл.',
              'Качество графики: Среднее',
              'Масштаб рендеринга: 100%'
            ]
          }
        }
      }
    }
  ];

  var BY_ID = {};
  LIST.forEach(function (g) { BY_ID[g.id] = g; });

  var STEPS = [30, 45, 60, 75, 90, 120, 144, 165, 240, 360];
  var PC_TIER = { 1: 75, 2: 165, 3: 300, 4: 1000 };
  var MOBILE_TIER = { 1: 60, 2: 90, 3: 120, 4: 144 };

  function isNum(n) { return typeof n === 'number' && isFinite(n) && n > 0; }
  function resolve(game) { return typeof game === 'string' ? BY_ID[game] || null : game || null; }
  /** 'pc' for windows-like platforms, otherwise 'android'. */
  function platKey(platform) { return /^(windows|pc|desktop|win)$/i.test(String(platform || '')) ? 'pc' : 'android'; }

  function platformOf(hw, platform) {
    if (G.devices && G.devices.platformOf) return G.devices.platformOf(hw, platform);
    return platKey(platform) === 'pc' ? 'windows' : 'android';
  }

  /**
   * FPS ceiling for a game on this hardware.
   * fpsLimit(game|id, hw, platform) -> {
   *   max, recommended, steps:number[],
   *   reasons:[{label:'экран'|'мощность'|'игра', value, limiting:bool}],
   *   tier, platform:'android'|'windows', supported:bool (game has a section for this platform) }
   * Android: max = min(display.maxRefreshHz, tierCap, game.android.fpsCap), recommended = max.
   * Windows: max = min(game.pc.fpsCap, pcTierCap), recommended = min(max, display.maxRefreshHz).
   */
  function fpsLimit(game, hw, platform) {
    var g = resolve(game);
    var plat = platformOf(hw, platform);
    var tier = 2;
    try {
      tier = G.devices && G.devices.classify ? G.devices.classify(hw, plat).tier : (hw && hw.tier) || 2;
    } catch (e) { tier = 2; }
    var caps = G.devices && G.devices.tierCaps ? G.devices.tierCaps : { android: MOBILE_TIER, windows: PC_TIER };
    var d = hw && hw.display ? hw.display : null;
    // < 30 Hz is not a real gaming display (Windows reports 0/1 for "default") -> treat as unknown
    var okHz = function (v) { return isNum(v) && v >= 30; };
    var screen = d ? (okHz(d.maxRefreshHz) ? d.maxRefreshHz : okHz(d.refreshHz) ? d.refreshHz : null) : null;
    if (screen) screen = Math.round(screen);
    var sec = g ? (plat === 'windows' ? g.pc : g.android) : null;
    var gameCap = sec && isNum(sec.fpsCap) ? Math.round(sec.fpsCap) : null;

    var reasons = [];
    if (plat === 'android') {
      reasons.push({ label: 'экран', value: screen || 60 });
      reasons.push({ label: 'мощность', value: caps.android[tier] || 60 });
      if (gameCap) reasons.push({ label: 'игра', value: gameCap });
    } else {
      if (gameCap) reasons.push({ label: 'игра', value: gameCap });
      reasons.push({ label: 'мощность', value: caps.windows[tier] || 165 });
    }
    var max = Math.min.apply(null, reasons.map(function (r) { return r.value; }));
    reasons.forEach(function (r) { r.limiting = r.value === max; });

    var recommended = max;
    if (plat === 'windows' && screen) recommended = Math.min(max, screen);

    var steps = STEPS.filter(function (s) { return s <= max; });
    if (steps.indexOf(max) < 0) steps.push(max);
    steps.sort(function (a, b) { return a - b; });

    return {
      max: max, recommended: recommended, steps: steps, reasons: reasons,
      tier: tier, platform: plat, supported: !!sec
    };
  }

  /**
   * Setting checklist. recipe(game|id, platform, 'potato'|'balanced', fps) -> [{section, items:[string]}]
   * {fps} is substituted. Empty array when the game has no recipe for this platform.
   */
  function recipe(game, platform, preset, fps) {
    var g = resolve(game);
    if (!g || !g.recipe) return [];
    var byPreset = g.recipe[platKey(platform)];
    if (!byPreset) return [];
    var secs = byPreset[preset] || byPreset.balanced || byPreset.potato;
    if (!secs) return [];
    var f = fps == null ? '' : String(fps);
    function sub(s) { return String(s).split('{fps}').join(f); }
    return Object.keys(secs).map(function (name) {
      return { section: sub(name), items: secs[name].map(sub) };
    });
  }

  /** Catalog entry by Android package id (exact, then case-insensitive). */
  function byPackage(pkg) {
    if (!pkg) return null;
    var p = String(pkg), low = p.toLowerCase(), hit = null;
    LIST.some(function (g) {
      if (g.android && g.android.packages.indexOf(p) >= 0) { hit = g; return true; }
      return false;
    });
    if (hit) return hit;
    LIST.some(function (g) {
      if (g.android && g.android.packages.some(function (x) { return x.toLowerCase() === low; })) { hit = g; return true; }
      return false;
    });
    return hit;
  }

  /**
   * Catalog entry for an InstalledGame (or its id string): by catalogId, 'steam:<appid>',
   * 'epic:<appName>', pc.match.key, or Android package. null when unknown.
   */
  function byInstalled(ig) {
    if (!ig) return null;
    var item = typeof ig === 'string' ? { id: ig } : ig;
    if (item.catalogId && BY_ID[item.catalogId]) return BY_ID[item.catalogId];
    var id = String(item.id || '');
    if (!id) return null;
    var m, hit = null;
    if ((m = /^steam:(\d+)$/i.exec(id))) {
      var appid = Number(m[1]);
      LIST.some(function (g) {
        if (g.pc && g.pc.match && (g.pc.match.steam || []).indexOf(appid) >= 0) { hit = g; return true; }
        return false;
      });
      return hit;
    }
    if ((m = /^epic:(.+)$/i.exec(id))) {
      var name = m[1].toLowerCase();
      LIST.some(function (g) {
        if (g.pc && g.pc.match && (g.pc.match.epic || []).some(function (e) { return e.toLowerCase() === name; })) { hit = g; return true; }
        return false;
      });
      return hit;
    }
    var low = id.toLowerCase();
    LIST.some(function (g) {
      if (g.pc && g.pc.match && g.pc.match.key && g.pc.match.key.toLowerCase() === low) { hit = g; return true; }
      return false;
    });
    return hit || byPackage(id);
  }

  G.games = {
    /** Full catalog (do not mutate). */
    list: LIST,
    /** Preset names for the UI. */
    presets: {
      potato: { title: 'Картошка', desc: 'Минимум графики — максимум FPS' },
      balanced: { title: 'Баланс', desc: 'Нормальная картинка и ровный FPS' }
    },
    /** Selectable FPS steps before filtering. */
    steps: STEPS.slice(),
    get: function (id) { return BY_ID[id] || null; },
    /** Entries that exist on a platform: forPlatform('android'|'windows'). */
    forPlatform: function (platform) {
      var k = platKey(platform);
      return LIST.filter(function (g) { return k === 'pc' ? !!g.pc : !!g.android; });
    },
    /** Every Android package id in the catalog (for host.games({knownPackages})). */
    allPackages: function () {
      var out = [];
      LIST.forEach(function (g) { if (g.android) out.push.apply(out, g.android.packages); });
      return out;
    },
    fpsLimit: function (game, hw, platform) {
      try { return fpsLimit(game, hw, platform); } catch (e) {
        return { max: 60, recommended: 60, steps: [30, 45, 60], reasons: [], tier: 2, platform: platformOf(hw, platform), supported: false };
      }
    },
    recipe: recipe,
    byPackage: byPackage,
    byInstalled: byInstalled
  };
})(window.GinN);
