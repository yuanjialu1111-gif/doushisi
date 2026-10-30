// Generated from APK FrameGameConfig. See ../NOTICE.md.
export const originalCatalogue = {
  "2": [
    {
      "name": "勾鱼一副牌",
      "gameId": 2,
      "rule": {
        "config_pay": {
          "name": "房费:",
          "multiple": 0,
          "maxCell": 3,
          "param": "useCardType",
          "config": [
            {
              "name": "AA",
              "value": 2,
              "default": 1,
              "wenhao": "所有人均摊"
            },
            {
              "name": "房主",
              "value": 1,
              "default": 0,
              "wenhao": "由创建房间玩家一人承担"
            }
          ]
        },
        "config_count": {
          "name": "局数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "gameNum",
          "config": [
            {
              "name": "4局",
              "value": 4,
              "default": 1
            },
            {
              "name": "8局",
              "value": 8,
              "default": 0
            },
            {
              "name": "12局",
              "value": 12,
              "default": 0
            }
          ]
        },
        "config_players": {
          "name": "人数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "playerNum",
          "config": [
            {
              "name": "2人",
              "value": 2,
              "default": 0
            },
            {
              "name": "3人",
              "value": 3,
              "default": 0
            },
            {
              "name": "4人",
              "value": 4,
              "default": 1
            }
          ]
        },
        "config_score": {
          "name": "底分:",
          "multiple": 0,
          "maxCell": 4,
          "param": "basicTimes",
          "config": [
            {
              "name": "0.1分",
              "value": 1,
              "default": 1
            },
            {
              "name": "0.2分",
              "value": 2,
              "default": 0
            },
            {
              "name": "0.5分",
              "value": 5,
              "default": 0
            },
            {
              "name": "1分",
              "value": 10,
              "default": 0
            }
          ]
        },
        "config_playmethod": {
          "name": "玩法:",
          "multiple": 1,
          "maxCell": 3,
          "config": [
            {
              "name": "七个七",
              "value": "qige7",
              "default": 1,
              "wenhao": "只要有7个七就算胡牌，赢50分"
            },
            {
              "name": "恰二十",
              "value": "qia20",
              "default": 1,
              "wenhao": "刚好红20点胡牌算50分"
            },
            {
              "name": "报叫",
              "value": "baoJiao",
              "default": 1,
              "wenhao": "起手有无红20点下叫，输赢50分"
            },
            {
              "name": "牌10加分",
              "value": "jiaqiang",
              "default": 1,
              "wenhao": "胡牌每个10额外加10分"
            }
          ]
        },
        "config_location": {
          "name": "定位:",
          "multiple": 1,
          "maxCell": 3,
          "config": [
            {
              "name": "开启GPS定位",
              "value": "openGps",
              "default": 0
            }
          ]
        }
      }
    },
    {
      "name": "勾鱼两副牌",
      "gameId": 2,
      "rule": {
        "config_pay": {
          "name": "房费:",
          "multiple": 0,
          "maxCell": 3,
          "param": "useCardType",
          "config": [
            {
              "name": "AA",
              "value": 2,
              "default": 1,
              "wenhao": "所有人均摊"
            },
            {
              "name": "房主",
              "value": 1,
              "default": 0,
              "wenhao": "由创建房间玩家一人承担"
            }
          ]
        },
        "config_count": {
          "name": "局数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "gameNum",
          "config": [
            {
              "name": "4局",
              "value": 4,
              "default": 1
            },
            {
              "name": "8局",
              "value": 8,
              "default": 0
            },
            {
              "name": "12局",
              "value": 12,
              "default": 0
            }
          ]
        },
        "config_players": {
          "name": "人数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "playerNum",
          "config": [
            {
              "name": "2人",
              "value": 2,
              "default": 0
            },
            {
              "name": "3人",
              "value": 3,
              "default": 0
            },
            {
              "name": "4人",
              "value": 4,
              "default": 1
            }
          ]
        },
        "config_score": {
          "name": "底分:",
          "multiple": 0,
          "maxCell": 4,
          "param": "basicTimes",
          "config": [
            {
              "name": "0.1分",
              "value": 1,
              "default": 1
            },
            {
              "name": "0.2分",
              "value": 2,
              "default": 0
            },
            {
              "name": "0.5分",
              "value": 5,
              "default": 0
            },
            {
              "name": "1分",
              "value": 10,
              "default": 0
            }
          ]
        },
        "config_playmethod": {
          "name": "玩法:",
          "multiple": 1,
          "maxCell": 3,
          "config": [
            {
              "name": "报叫",
              "value": "baoJiao",
              "default": 1,
              "wenhao": "起手有无红20点下叫，输赢50分"
            },
            {
              "name": "恰二十",
              "value": "qia20",
              "default": 1,
              "wenhao": "刚好红20点胡牌算50分"
            },
            {
              "name": "牌10加分",
              "value": "jiaqiang",
              "default": 1,
              "wenhao": "胡牌每个10额外加10分"
            },
            {
              "name": "八个十天胡",
              "value": "bage10tianhu",
              "default": 1,
              "wenhao": "庄家起手8个10天胡算100分"
            }
          ]
        },
        "config_location": {
          "name": "定位:",
          "multiple": 1,
          "maxCell": 3,
          "config": [
            {
              "name": "开启GPS定位",
              "value": "openGps",
              "default": 0
            }
          ]
        }
      }
    }
  ],
  "3": [
    {
      "name": "火十四",
      "gameId": 3,
      "rule": {
        "config_pay": {
          "name": "房费:",
          "maxCell": 3,
          "multiple": 0,
          "param": "useCardType",
          "config": [
            {
              "name": "AA",
              "value": 2,
              "default": 1,
              "wenhao": "所有人均摊"
            },
            {
              "name": "房主",
              "value": 1,
              "default": 0,
              "wenhao": "由创建房间玩家一人承担"
            }
          ]
        },
        "config_count": {
          "name": "局数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "gameNum",
          "config": [
            {
              "name": "4局",
              "value": 4,
              "default": 1
            },
            {
              "name": "8局",
              "value": 8,
              "default": 0
            },
            {
              "name": "12局",
              "value": 12,
              "default": 0
            }
          ]
        },
        "config_players": {
          "name": "人数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "playerNum",
          "config": [
            {
              "name": "2人",
              "value": 2,
              "default": 0
            },
            {
              "name": "3人",
              "value": 3,
              "default": 0
            },
            {
              "name": "4人",
              "value": 4,
              "default": 1
            }
          ]
        },
        "config_score": {
          "name": "底分:",
          "multiple": 0,
          "maxCell": 4,
          "param": "basicTimes",
          "config": [
            {
              "name": "0.1分",
              "value": 1,
              "default": 1
            },
            {
              "name": "0.2分",
              "value": 2,
              "default": 0
            },
            {
              "name": "0.5分",
              "value": 5,
              "default": 0
            },
            {
              "name": "1分",
              "value": 10,
              "default": 0
            }
          ]
        },
        "config_yifupai": {
          "name": "规则:",
          "multiple": 0,
          "maxCell": 3,
          "param": "yifupai",
          "config": [
            {
              "name": "一副牌",
              "value": true,
              "default": 1,
              "wenhao": "6个10，6个7（4个7加大小王），6个4"
            },
            {
              "name": "两副牌",
              "value": false,
              "default": 0,
              "wenhao": "8个10，12个7（8个7加4个大小王），8个4"
            }
          ]
        },
        "config_playmethod": {
          "name": "玩法:",
          "multiple": 1,
          "maxCell": 3,
          "config": [
            {
              "name": "报叫",
              "value": "baoJiao",
              "default": 1,
              "wenhao": "起手有无红20点下叫，输赢50分"
            },
            {
              "name": "白皮",
              "value": "baipi",
              "default": 1,
              "wenhao": "白皮当癞子可以替换成任意牌"
            },
            {
              "name": "牌10加分",
              "value": "jiaqiang",
              "default": 1,
              "wenhao": "胡牌每个10额外加10分"
            },
            {
              "name": "恰二十",
              "value": "qia20",
              "default": 1,
              "wenhao": "刚好红20点胡牌算50分"
            },
            {
              "name": "八个10天胡",
              "value": "bage10tianhu",
              "default": 1,
              "wenhao": "庄家起手8个10天胡算100分"
            }
          ]
        },
        "config_location": {
          "name": "定位:",
          "maxCell": 3,
          "multiple": 1,
          "config": [
            {
              "name": "开启GPS定位",
              "value": "openGps",
              "default": 0
            }
          ]
        }
      }
    }
  ],
  "4": [
    {
      "name": "新津斗十四",
      "gameId": 4,
      "rule": {
        "config_pay": {
          "name": "房费:",
          "multiple": 0,
          "maxCell": 3,
          "param": "useCardType",
          "config": [
            {
              "name": "AA",
              "value": 2,
              "default": 1,
              "wenhao": "所有人均摊"
            },
            {
              "name": "房主",
              "value": 1,
              "default": 0,
              "wenhao": "由创建房间玩家一人承担"
            }
          ]
        },
        "config_count": {
          "name": "局数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "gameNum",
          "config": [
            {
              "name": "4局",
              "value": 4,
              "default": 0
            },
            {
              "name": "8局",
              "value": 8,
              "default": 1
            },
            {
              "name": "12局",
              "value": 12,
              "default": 0
            }
          ]
        },
        "config_players": {
          "name": "人数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "playerNum",
          "config": [
            {
              "name": "2人",
              "value": 2,
              "default": 0
            },
            {
              "name": "3人",
              "value": 3,
              "default": 0
            },
            {
              "name": "4人",
              "value": 4,
              "default": 1
            }
          ]
        },
        "config_fengding": {
          "name": "封顶:",
          "multiple": 0,
          "maxCell": 4,
          "param": "maxFan",
          "config": [
            {
              "name": "4番",
              "value": 4,
              "default": 0
            },
            {
              "name": "5番",
              "value": 5,
              "default": 0
            },
            {
              "name": "6番",
              "value": 6,
              "default": 0
            },
            {
              "name": "不封顶",
              "value": 99,
              "default": 1
            }
          ]
        },
        "config_eat": {
          "name": "吃牌:",
          "multiple": 0,
          "maxCell": 3,
          "param": "ziChi",
          "config": [
            {
              "name": "自摸自吃",
              "value": 1,
              "default": 0
            },
            {
              "name": "可吃上家",
              "value": 0,
              "default": 1
            }
          ]
        },
        "config_fan": {
          "name": "番数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "chengFan",
          "config": [
            {
              "name": "跟斗翻",
              "value": 1,
              "default": 1,
              "wenhao": "1*2^（所有番数之和），如4番算16分"
            },
            {
              "name": "梯坎翻",
              "value": 0,
              "default": 0,
              "wenhao": "1+ 所有番数，如4番算5分"
            }
          ]
        },
        "config_wang": {
          "name": "王数:",
          "multiple": 0,
          "maxCell": 4,
          "param": "wangNum",
          "config": [
            {
              "name": "3",
              "value": 3,
              "default": 1,
              "wenhao": "1小王、1大王、1白板"
            },
            {
              "name": "5",
              "value": 5,
              "default": 0,
              "wenhao": "2小王、2大王、1白板"
            },
            {
              "name": "6",
              "value": 6,
              "default": 0,
              "wenhao": "2小王、2大王、2白板"
            },
            {
              "name": "9",
              "value": 9,
              "default": 0,
              "wenhao": "3小王、3大王、3白板"
            }
          ]
        },
        "config_playmethod": {
          "name": "玩法:",
          "multiple": 1,
          "maxCell": 3,
          "config": [
            {
              "name": "7当王",
              "value": "qiToWang",
              "default": 0,
              "wenhao": "7当王直接偷，一个7一番"
            },
            {
              "name": "报叫1番",
              "value": "baoJiao",
              "default": 0,
              "wenhao": "报叫加1番"
            },
            {
              "name": "地胡3番",
              "value": "diHu",
              "default": 0,
              "wenhao": "地胡加3番"
            },
            {
              "name": "天胡3番",
              "value": "tianHu",
              "default": 0,
              "wenhao": "天胡加3番"
            },
            {
              "name": "暗四对",
              "value": "anDui",
              "default": 0,
              "wenhao": "手里全是对子的胡牌加3番"
            },
            {
              "name": "恰二十1番",
              "value": "qia20",
              "default": 0,
              "wenhao": "刚好红20加1番"
            },
            {
              "name": "龙对",
              "value": "longDui",
              "default": 0,
              "wenhao": "手里有四个一样的对子的胡牌加4番"
            },
            {
              "name": "五小",
              "value": "xiaoHu",
              "default": 0,
              "wenhao": "胡牌后都是23JQKA这类牌型加3番"
            },
            {
              "name": "红40",
              "value": "qia40",
              "default": 0,
              "wenhao": "红40点加2番"
            },
            {
              "name": "红50",
              "value": "qia50",
              "default": 0,
              "wenhao": "红50点加3番"
            },
            {
              "name": "四归一",
              "value": "siGuiYi",
              "default": 0,
              "wenhao": "碰牌后胡碰的那张牌加1番"
            }
          ]
        },
        "config_location": {
          "name": "定位:",
          "multiple": 1,
          "maxCell": 3,
          "config": [
            {
              "name": "开启GPS定位",
              "value": "openGps",
              "default": 0
            }
          ]
        }
      }
    }
  ],
  "5": [
    {
      "name": "安岳斗十四",
      "gameId": 5,
      "rule": {
        "config_pay": {
          "name": "房费:",
          "multiple": 0,
          "maxCell": 3,
          "param": "useCardType",
          "config": [
            {
              "name": "AA",
              "value": 2,
              "default": 1,
              "wenhao": "所有人均摊"
            },
            {
              "name": "房主",
              "value": 1,
              "default": 0,
              "wenhao": "由创建房间玩家一人承担"
            }
          ]
        },
        "config_count": {
          "name": "局数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "gameNum",
          "config": [
            {
              "name": "4局",
              "value": 4,
              "default": 0
            },
            {
              "name": "8局",
              "value": 8,
              "default": 1
            },
            {
              "name": "12局",
              "value": 12,
              "default": 0
            }
          ]
        },
        "config_players": {
          "name": "人数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "playerNum",
          "config": [
            {
              "name": "2人",
              "value": 2,
              "default": 0
            },
            {
              "name": "3人",
              "value": 3,
              "default": 0
            },
            {
              "name": "4人",
              "value": 4,
              "default": 1
            }
          ]
        },
        "config_piaoType": {
          "name": "打漂:",
          "multiple": 0,
          "maxCell": 3,
          "param": "piaoType",
          "config": [
            {
              "name": "不漂",
              "value": 0,
              "default": 1
            },
            {
              "name": "必漂",
              "value": 1,
              "default": 0
            },
            {
              "name": "选漂",
              "value": 2,
              "default": 0
            }
          ]
        },
        "config_fan": {
          "name": "算分:",
          "multiple": 0,
          "maxCell": 3,
          "param": "chengFan",
          "config": [
            {
              "name": "滚滚翻",
              "value": 1,
              "default": 1,
              "wenhao": "分数=底*基本分（漂）*番数1*番数2*。。。*番数N；"
            },
            {
              "name": "颗颗加",
              "value": 0,
              "default": 0,
              "wenhao": "分数=底+基本分（漂）+番数1+番数2+。。。+番数N"
            }
          ]
        },
        "config_fengding": {
          "name": "封顶:",
          "multiple": 0,
          "maxCell": 4,
          "param": "maxFan",
          "config": [
            {
              "name": "4番",
              "value": 4,
              "default": 0
            },
            {
              "name": "5番",
              "value": 5,
              "default": 0
            },
            {
              "name": "6番",
              "value": 6,
              "default": 0
            },
            {
              "name": "不封顶",
              "value": 99,
              "default": 1
            }
          ]
        },
        "config_playmethod": {
          "name": "玩法:",
          "multiple": 1,
          "maxCell": 3,
          "config": [
            {
              "name": "7当王",
              "value": "qiToWang",
              "default": 1
            },
            {
              "name": "对子胡",
              "value": "anDui",
              "default": 1
            },
            {
              "name": "点炮包赔",
              "value": "dianpaoBaopei",
              "default": 1
            },
            {
              "name": "打庄算番",
              "value": "zhuangJiadi",
              "default": 1
            },
            {
              "name": "扯拢算番",
              "value": "cheLong",
              "default": 1
            },
            {
              "name": "全红、全黑3番",
              "value": "quanHongHei",
              "default": 1
            }
          ]
        },
        "config_location": {
          "name": "定位:",
          "multiple": 1,
          "maxCell": 3,
          "config": [
            {
              "name": "开启GPS定位",
              "value": "openGps",
              "default": 0
            }
          ]
        }
      }
    }
  ],
  "6": [
    {
      "name": "雅安红二十",
      "gameId": 6,
      "rule": {
        "config_pay": {
          "name": "房费:",
          "multiple": 0,
          "maxCell": 3,
          "param": "useCardType",
          "config": [
            {
              "name": "AA",
              "value": 2,
              "default": 1,
              "wenhao": "所有人均摊"
            },
            {
              "name": "房主",
              "value": 1,
              "default": 0,
              "wenhao": "由创建房间玩家一人承担"
            }
          ]
        },
        "config_count": {
          "name": "局数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "gameNum",
          "config": [
            {
              "name": "4局",
              "value": 4,
              "default": 1
            },
            {
              "name": "8局",
              "value": 8,
              "default": 0
            },
            {
              "name": "12局",
              "value": 12,
              "default": 0
            }
          ]
        },
        "config_players": {
          "name": "人数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "playerNum",
          "config": [
            {
              "name": "2人",
              "value": 2,
              "default": 0
            },
            {
              "name": "3人",
              "value": 3,
              "default": 1
            },
            {
              "name": "4人",
              "value": 4,
              "default": 0
            }
          ]
        },
        "config_eat": {
          "name": "吃牌:",
          "multiple": 0,
          "maxCell": 3,
          "param": "ziChi",
          "config": [
            {
              "name": "自摸自吃",
              "value": 1,
              "default": 1
            },
            {
              "name": "可吃上家",
              "value": 0,
              "default": 0
            }
          ]
        },
        "config_wang": {
          "name": "王数:",
          "multiple": 0,
          "maxCell": 4,
          "param": "wangNum",
          "config": [
            {
              "name": "3",
              "value": 3,
              "default": 0,
              "wenhao": "1小王、1大王、1白板"
            },
            {
              "name": "6",
              "value": 6,
              "default": 1,
              "wenhao": "2小王、2大王、2白板"
            },
            {
              "name": "9",
              "value": 9,
              "default": 0,
              "wenhao": "3小王、3大王、3白板"
            },
            {
              "name": "12",
              "value": 12,
              "default": 0,
              "wenhao": "4小王、4大王、4白板"
            }
          ]
        },
        "config_qi_wang": {
          "name": "7当王:",
          "multiple": 0,
          "maxCell": 4,
          "param": "qiWangNum",
          "config": [
            {
              "name": "0",
              "value": 0,
              "default": 0,
              "wenhao": "1副牌的4个7不当王，按正常牌用"
            },
            {
              "name": "4",
              "value": 4,
              "default": 0,
              "wenhao": "1副牌的4个7当王"
            },
            {
              "name": "6",
              "value": 6,
              "default": 0,
              "wenhao": "1副牌的4个7再加上一个红7和一个黑7当王"
            },
            {
              "name": "8",
              "value": 8,
              "default": 1,
              "wenhao": "2副牌的7当王"
            },
            {
              "name": "12",
              "value": 12,
              "default": 0,
              "wenhao": "3副牌的7当王"
            }
          ]
        },
        "config_fan": {
          "name": "算分:",
          "maxCell": 3,
          "offset": 350,
          "multiple": 0,
          "param": "chengFan",
          "config": [
            {
              "name": "滚滚翻(翻相乘)",
              "value": 1,
              "default": 0,
              "wenhao": "1*2(各番数之和)，如4番就是16分"
            },
            {
              "name": "梯坎翻(翻相加)",
              "value": 0,
              "default": 1,
              "wenhao": "1+所有番数，如4番算5分"
            }
          ]
        },
        "config_playmethod": {
          "name": "玩法:",
          "multiple": 1,
          "maxCell": 3,
          "config": [
            {
              "name": "红50和黑50",
              "value": "hongHei_50",
              "default": 1
            },
            {
              "name": "报叫三番",
              "value": "baoJiao",
              "default": 1
            },
            {
              "name": "金二十一番",
              "value": "qia20",
              "default": 1,
              "wenhao": "刚好红20点算1番"
            },
            {
              "name": "杠上花",
              "value": "gangHua",
              "default": 1
            },
            {
              "name": "杠上炮",
              "value": "gangPao",
              "default": 1
            },
            {
              "name": "黄庄查叫",
              "value": "chaJiao",
              "default": 1
            },
            {
              "name": "金钩钓",
              "value": "jinGouDiao",
              "default": 0,
              "wenhao": "碰光，手里只留一张牌"
            },
            {
              "name": "暗四对三番",
              "value": "anDui",
              "default": 0,
              "wenhao": "每个龙加3番"
            }
          ]
        },
        "config_location": {
          "name": "定位:",
          "multiple": 1,
          "maxCell": 3,
          "config": [
            {
              "name": "开启GPS定位",
              "value": "openGps",
              "default": 0
            }
          ]
        }
      }
    }
  ],
  "7": [
    {
      "name": "蒲江斗十四",
      "gameId": 7,
      "rule": {
        "config_pay": {
          "name": "房费:",
          "multiple": 0,
          "maxCell": 3,
          "param": "useCardType",
          "config": [
            {
              "name": "AA",
              "value": 2,
              "default": 1,
              "wenhao": "所有人均摊"
            },
            {
              "name": "房主",
              "value": 1,
              "default": 0,
              "wenhao": "由创建房间玩家一人承担"
            }
          ]
        },
        "config_count": {
          "name": "局数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "gameNum",
          "config": [
            {
              "name": "4局",
              "value": 4,
              "default": 1
            },
            {
              "name": "8局",
              "value": 8,
              "default": 0
            },
            {
              "name": "12局",
              "value": 12,
              "default": 0
            }
          ]
        },
        "config_players": {
          "name": "人数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "playerNum",
          "config": [
            {
              "name": "2人",
              "value": 2,
              "default": 0
            },
            {
              "name": "3人",
              "value": 3,
              "default": 1
            },
            {
              "name": "4人",
              "value": 4,
              "default": 0
            }
          ]
        },
        "config_fengding": {
          "name": "封顶:",
          "multiple": 0,
          "maxCell": 4,
          "param": "maxFan",
          "config": [
            {
              "name": "4番",
              "value": 4,
              "default": 0
            },
            {
              "name": "5番",
              "value": 5,
              "default": 0
            },
            {
              "name": "6番",
              "value": 6,
              "default": 0
            },
            {
              "name": "不封顶",
              "value": 99,
              "default": 1
            }
          ]
        },
        "config_wang": {
          "name": "王数:",
          "multiple": 0,
          "maxCell": 4,
          "param": "wangNum",
          "config": [
            {
              "name": "6",
              "value": 6,
              "default": 0,
              "wenhao": "2小王、2大王、2白板"
            },
            {
              "name": "9",
              "value": 9,
              "default": 1,
              "wenhao": "3小王、3大王、3白板"
            },
            {
              "name": "12",
              "value": 12,
              "default": 0,
              "wenhao": "4小王、4大王、4白板"
            },
            {
              "name": "15",
              "value": 15,
              "default": 0,
              "wenhao": "5小王、5大王、5白板"
            }
          ]
        },
        "config_baoJiaoYingbao": {
          "name": "报叫:",
          "multiple": 0,
          "maxCell": 3,
          "offset": 400,
          "param": "baoJiaoYingbao",
          "config": [
            {
              "name": "已有红20",
              "value": 1,
              "default": 1,
              "wenhao": "不包括胡牌已有红20点"
            },
            {
              "name": "含胡牌红20",
              "value": 0,
              "default": 0,
              "wenhao": "包括胡牌够红20点"
            }
          ]
        },
        "config_chaJiao": {
          "name": "查叫:",
          "multiple": 0,
          "maxCell": 2,
          "offset": 400,
          "param": "chaJiao",
          "config": [
            {
              "name": "黄庄查叫",
              "value": 1,
              "default": 1
            },
            {
              "name": "黄庄不查叫",
              "value": 0,
              "default": 0
            }
          ]
        },
        "config_fan": {
          "name": "算分:",
          "maxCell": 2,
          "offset": 400,
          "multiple": 0,
          "param": "chengFan",
          "config": [
            {
              "name": "滚滚翻(翻相乘)",
              "value": 1,
              "default": 0,
              "wenhao": "1*2(各番数之和)，如4番就是16分"
            },
            {
              "name": "梯坎翻(翻相加)",
              "value": 0,
              "default": 1,
              "wenhao": "1+所有番数，如4番算5分"
            }
          ]
        },
        "config_playmethod": {
          "name": "玩法:",
          "multiple": 1,
          "maxCell": 3,
          "offset": 250,
          "config": [
            {
              "name": "金二十3番",
              "value": "qia20",
              "default": 1,
              "wenhao": "刚好红20点算3番"
            },
            {
              "name": "金钩钓",
              "value": "jinGouDiao",
              "default": 1,
              "wenhao": "碰光，手里剩1张胡单吊算3番"
            },
            {
              "name": "暗四对3番",
              "value": "anDui",
              "default": 1,
              "wenhao": "对子胡，每个龙另外加3番"
            },
            {
              "name": "可平胡",
              "value": "keSuHu",
              "default": 0,
              "wenhao": "至少1番才能胡，但平胡自己翻到胡牌可胡算3番"
            },
            {
              "name": "四归一",
              "value": "siGuiYi",
              "default": 0,
              "wenhao": "不是杠，胡牌中能凑够四同张的加1番"
            }
          ]
        },
        "config_location": {
          "name": "定位:",
          "multiple": 1,
          "maxCell": 3,
          "config": [
            {
              "name": "开启GPS定位",
              "value": "openGps",
              "default": 0
            }
          ]
        }
      }
    }
  ],
  "8": [
    {
      "name": "邛崃斗十四",
      "gameId": 8,
      "rule": {
        "config_pay": {
          "name": "房费:",
          "multiple": 0,
          "maxCell": 3,
          "param": "useCardType",
          "config": [
            {
              "name": "AA",
              "value": 2,
              "default": 1,
              "wenhao": "所有人均摊"
            },
            {
              "name": "房主",
              "value": 1,
              "default": 0,
              "wenhao": "由创建房间玩家一人承担"
            }
          ]
        },
        "config_count": {
          "name": "局数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "gameNum",
          "config": [
            {
              "name": "4局",
              "value": 4,
              "default": 1
            },
            {
              "name": "8局",
              "value": 8,
              "default": 0
            },
            {
              "name": "12局",
              "value": 12,
              "default": 0
            }
          ]
        },
        "config_players": {
          "name": "人数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "playerNum",
          "config": [
            {
              "name": "2人",
              "value": 2,
              "default": 0
            },
            {
              "name": "3人",
              "value": 3,
              "default": 1
            },
            {
              "name": "4人",
              "value": 4,
              "default": 0
            }
          ]
        },
        "config_fengding": {
          "name": "封顶:",
          "multiple": 0,
          "maxCell": 4,
          "param": "maxFan",
          "config": [
            {
              "name": "4番",
              "value": 4,
              "default": 0
            },
            {
              "name": "5番",
              "value": 5,
              "default": 0
            },
            {
              "name": "6番",
              "value": 6,
              "default": 0
            },
            {
              "name": "不封顶",
              "value": 99,
              "default": 1
            }
          ]
        },
        "config_wang": {
          "name": "王数:",
          "multiple": 0,
          "maxCell": 4,
          "param": "wangNum",
          "config": [
            {
              "name": "3",
              "value": 3,
              "default": 0,
              "wenhao": "1小王、1大王、1白板"
            },
            {
              "name": "6",
              "value": 6,
              "default": 0,
              "wenhao": "2小王、2大王、2白板"
            },
            {
              "name": "9",
              "value": 9,
              "default": 1,
              "wenhao": "3小王、3大王、3白板"
            },
            {
              "name": "12",
              "value": 12,
              "default": 0,
              "wenhao": "4小王、4大王、4白板"
            },
            {
              "name": "15",
              "value": 15,
              "default": 0,
              "wenhao": "5小王、5大王、5白板"
            },
            {
              "name": "18",
              "value": 18,
              "default": 0,
              "wenhao": "6小王、6大王、6白板"
            }
          ]
        },
        "config_baoJiaoYingbao": {
          "name": "报叫:",
          "multiple": 0,
          "maxCell": 3,
          "offset": 400,
          "param": "baoJiaoYingbao",
          "config": [
            {
              "name": "已有红20",
              "value": 1,
              "default": 1,
              "wenhao": "不包括胡牌已有红20点"
            },
            {
              "name": "含胡牌红20",
              "value": 0,
              "default": 0,
              "wenhao": "包括胡牌够红20点"
            }
          ]
        },
        "config_chaJiao": {
          "name": "查叫:",
          "multiple": 0,
          "maxCell": 2,
          "offset": 400,
          "param": "chaJiao",
          "config": [
            {
              "name": "黄庄查叫",
              "value": 1,
              "default": 1
            },
            {
              "name": "黄庄不查叫",
              "value": 0,
              "default": 0
            }
          ]
        },
        "config_fan": {
          "name": "算分:",
          "maxCell": 2,
          "offset": 400,
          "multiple": 0,
          "param": "chengFan",
          "config": [
            {
              "name": "滚滚翻(翻相乘)",
              "value": 1,
              "default": 0,
              "wenhao": "1*2(各番数之和)，如4番就是16分"
            },
            {
              "name": "梯坎翻(翻相加)",
              "value": 0,
              "default": 1,
              "wenhao": "1+所有番数，如4番算5分"
            }
          ]
        },
        "config_playmethod": {
          "name": "玩法:",
          "multiple": 1,
          "maxCell": 3,
          "offset": 250,
          "config": [
            {
              "name": "金二十3番",
              "value": "qia20",
              "default": 1,
              "wenhao": "刚好红20点算3番"
            },
            {
              "name": "金钩钓",
              "value": "jinGouDiao",
              "default": 1,
              "wenhao": "碰光，手里剩1张胡单吊算3番"
            },
            {
              "name": "暗四对3番",
              "value": "anDui",
              "default": 1,
              "wenhao": "对子胡，每个龙另外加3番"
            },
            {
              "name": "可平胡",
              "value": "keSuHu",
              "default": 0,
              "wenhao": "至少1番才能胡，但平胡自己翻到胡牌可胡算3番"
            },
            {
              "name": "四归一",
              "value": "siGuiYi",
              "default": 0,
              "wenhao": "不是杠，胡牌中能凑够四同张的加1番"
            }
          ]
        },
        "config_location": {
          "name": "定位:",
          "multiple": 1,
          "maxCell": 3,
          "config": [
            {
              "name": "开启GPS定位",
              "value": "openGps",
              "default": 0
            }
          ]
        }
      }
    }
  ],
  "9": [
    {
      "name": "阿坝斗十四",
      "gameId": 9,
      "rule": {
        "config_pay": {
          "name": "房费:",
          "multiple": 0,
          "maxCell": 3,
          "param": "useCardType",
          "config": [
            {
              "name": "AA",
              "value": 2,
              "default": 1,
              "wenhao": "所有人均摊"
            },
            {
              "name": "房主",
              "value": 1,
              "default": 0,
              "wenhao": "由创建房间玩家一人承担"
            }
          ]
        },
        "config_count": {
          "name": "局数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "gameNum",
          "config": [
            {
              "name": "4局",
              "value": 4,
              "default": 1
            },
            {
              "name": "8局",
              "value": 8,
              "default": 0
            },
            {
              "name": "12局",
              "value": 12,
              "default": 0
            }
          ]
        },
        "config_players": {
          "name": "人数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "playerNum",
          "config": [
            {
              "name": "2人",
              "value": 2,
              "default": 0
            },
            {
              "name": "3人",
              "value": 3,
              "default": 0
            },
            {
              "name": "4人",
              "value": 4,
              "default": 1
            }
          ]
        },
        "config_redScore": {
          "name": "胡牌:",
          "multiple": 0,
          "maxCell": 3,
          "param": "huRedScore",
          "config": [
            {
              "name": "300分",
              "value": 300,
              "default": 1
            },
            {
              "name": "400分",
              "value": 400,
              "default": 0
            },
            {
              "name": "500分",
              "value": 500,
              "default": 0
            }
          ]
        },
        "config_baojiao": {
          "name": "报叫:",
          "multiple": 0,
          "maxCell": 2,
          "offset": 400,
          "param": "baojiaoCondition",
          "config": [
            {
              "name": "比起胡分数少100分",
              "value": 1,
              "default": 1,
              "wenhao": "如起胡选300分，200分可报叫"
            },
            {
              "name": "与起胡分数一样",
              "value": 2,
              "default": 0,
              "wenhao": "如起胡选300分，需要300分才能报叫"
            },
            {
              "name": "翻1番后达到起胡分数",
              "value": 3,
              "default": 0,
              "wenhao": "如起胡选300分，报叫翻一番，那么200分就可报叫"
            }
          ]
        },
        "config_fanbaipi": {
          "name": "翻白皮:",
          "multiple": 0,
          "maxCell": 2,
          "offset": 400,
          "param": "baipiType",
          "config": [
            {
              "name": "直接摸上手",
              "value": 1,
              "default": 1
            },
            {
              "name": "不上手只能自己用",
              "value": 2,
              "default": 0,
              "wenhao": "只能自己偷、吃、碰、杠、胡等，其他人不能"
            },
            {
              "name": "不上手大家都可以用",
              "value": 3,
              "default": 0,
              "wenhao": "自己和其他家都可以偷、吃、碰、杠、胡等"
            }
          ]
        },
        "config_fengding": {
          "name": "封顶:",
          "multiple": 0,
          "maxCell": 4,
          "param": "maxFan",
          "config": [
            {
              "name": "不封顶",
              "value": 99,
              "default": 1
            },
            {
              "name": "2番",
              "value": 2,
              "default": 0
            },
            {
              "name": "3番",
              "value": 3,
              "default": 0
            },
            {
              "name": "4番",
              "value": 4,
              "default": 0
            }
          ]
        },
        "config_playmethod": {
          "name": "玩法:",
          "multiple": 1,
          "maxCell": 3,
          "offset": 250,
          "config": [
            {
              "name": "海底捞",
              "value": "haiDiLao",
              "default": 0,
              "wenhao": "最后一张牌胡牌"
            },
            {
              "name": "258加番",
              "value": "jiaFan_258",
              "default": 0,
              "wenhao": "碰258算1番，杠258算2番"
            },
            {
              "name": "双进双出",
              "value": "doubleInOut",
              "default": 0,
              "wenhao": "双王和四个七输赢双方加1番"
            },
            {
              "name": "头炮算一番",
              "value": "diHu",
              "default": 1
            },
            {
              "name": "碰凑胡算1番",
              "value": "cheLong",
              "default": 0,
              "wenhao": "偷牌自摸算一番"
            }
          ]
        },
        "config_location": {
          "name": "定位:",
          "multiple": 1,
          "maxCell": 3,
          "config": [
            {
              "name": "开启GPS定位",
              "value": "openGps",
              "default": 0
            }
          ]
        }
      }
    }
  ],
  "10": [
    {
      "name": "阿坝斗十四",
      "gameId": 10,
      "rule": {
        "config_pay": {
          "name": "房费:",
          "multiple": 0,
          "maxCell": 3,
          "param": "useCardType",
          "config": [
            {
              "name": "AA",
              "value": 2,
              "default": 1,
              "wenhao": "所有人均摊"
            },
            {
              "name": "房主",
              "value": 1,
              "default": 0,
              "wenhao": "由创建房间玩家一人承担"
            }
          ]
        },
        "config_count": {
          "name": "局数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "gameNum",
          "config": [
            {
              "name": "4局",
              "value": 4,
              "default": 1
            },
            {
              "name": "8局",
              "value": 8,
              "default": 0
            },
            {
              "name": "12局",
              "value": 12,
              "default": 0
            }
          ]
        },
        "config_players": {
          "name": "人数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "playerNum",
          "config": [
            {
              "name": "2人",
              "value": 2,
              "default": 0
            },
            {
              "name": "3人",
              "value": 3,
              "default": 0
            },
            {
              "name": "4人",
              "value": 4,
              "default": 1
            }
          ]
        },
        "config_redScore": {
          "name": "胡牌:",
          "multiple": 0,
          "maxCell": 3,
          "param": "huRedScore",
          "config": [
            {
              "name": "300分",
              "value": 300,
              "default": 1
            },
            {
              "name": "400分",
              "value": 400,
              "default": 0
            },
            {
              "name": "500分",
              "value": 500,
              "default": 0
            }
          ]
        },
        "config_baojiao": {
          "name": "报叫:",
          "multiple": 0,
          "maxCell": 2,
          "offset": 400,
          "param": "baojiaoCondition",
          "config": [
            {
              "name": "比起胡分数少100分",
              "value": 1,
              "default": 1,
              "wenhao": "如起胡选300分，200分可报叫"
            },
            {
              "name": "与起胡分数一样",
              "value": 2,
              "default": 0,
              "wenhao": "如起胡选300分，需要300分才能报叫"
            },
            {
              "name": "翻1番后达到起胡分数",
              "value": 3,
              "default": 0,
              "wenhao": "如起胡选300分，报叫翻一番，那么200分就可报叫"
            }
          ]
        },
        "config_fanbaipi": {
          "name": "翻白皮:",
          "multiple": 0,
          "maxCell": 2,
          "offset": 400,
          "param": "baipiType",
          "config": [
            {
              "name": "直接摸上手",
              "value": 1,
              "default": 1
            },
            {
              "name": "不上手只能自己用",
              "value": 2,
              "default": 0,
              "wenhao": "只能自己偷、吃、碰、杠、胡等，其他人不能"
            },
            {
              "name": "不上手大家都可以用",
              "value": 3,
              "default": 0,
              "wenhao": "自己和其他家都可以偷、吃、碰、杠、胡等"
            }
          ]
        },
        "config_fengding": {
          "name": "封顶:",
          "multiple": 0,
          "maxCell": 4,
          "param": "maxFan",
          "config": [
            {
              "name": "不封顶",
              "value": 99,
              "default": 1
            },
            {
              "name": "2番",
              "value": 2,
              "default": 0
            },
            {
              "name": "3番",
              "value": 3,
              "default": 0
            },
            {
              "name": "4番",
              "value": 4,
              "default": 0
            }
          ]
        },
        "config_playmethod": {
          "name": "玩法:",
          "multiple": 1,
          "maxCell": 3,
          "offset": 250,
          "config": [
            {
              "name": "海底捞",
              "value": "haiDiLao",
              "default": 0,
              "wenhao": "最后一张牌胡牌"
            },
            {
              "name": "258加番",
              "value": "jiaFan_258",
              "default": 0,
              "wenhao": "碰258算1番，杠258算2番"
            },
            {
              "name": "双进双出",
              "value": "doubleInOut",
              "default": 0,
              "wenhao": "双王和四个七输赢双方加1番"
            },
            {
              "name": "头炮算一番",
              "value": "diHu",
              "default": 0
            },
            {
              "name": "碰凑胡算1番",
              "value": "cheLong",
              "default": 1,
              "wenhao": "偷牌自摸算一番"
            }
          ]
        },
        "config_location": {
          "name": "定位:",
          "multiple": 1,
          "maxCell": 3,
          "config": [
            {
              "name": "开启GPS定位",
              "value": "openGps",
              "default": 0
            }
          ]
        }
      }
    }
  ],
  "11": [
    {
      "name": "马尔康斗十四",
      "gameId": 11,
      "rule": {
        "config_pay": {
          "name": "房费:",
          "multiple": 0,
          "maxCell": 3,
          "param": "useCardType",
          "config": [
            {
              "name": "AA",
              "value": 2,
              "default": 1,
              "wenhao": "所有人均摊"
            },
            {
              "name": "房主",
              "value": 1,
              "default": 0,
              "wenhao": "由创建房间玩家一人承担"
            }
          ]
        },
        "config_count": {
          "name": "局数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "gameNum",
          "config": [
            {
              "name": "4局",
              "value": 4,
              "default": 1
            },
            {
              "name": "8局",
              "value": 8,
              "default": 0
            },
            {
              "name": "12局",
              "value": 12,
              "default": 0
            }
          ]
        },
        "config_players": {
          "name": "人数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "playerNum",
          "config": [
            {
              "name": "2人",
              "value": 2,
              "default": 0
            },
            {
              "name": "3人",
              "value": 3,
              "default": 0
            },
            {
              "name": "4人",
              "value": 4,
              "default": 1
            }
          ]
        },
        "config_redScore": {
          "name": "胡牌:",
          "multiple": 0,
          "maxCell": 3,
          "param": "huRedScore",
          "config": [
            {
              "name": "300分",
              "value": 300,
              "default": 1
            },
            {
              "name": "400分",
              "value": 400,
              "default": 0
            },
            {
              "name": "500分",
              "value": 500,
              "default": 0
            }
          ]
        },
        "config_baojiao": {
          "name": "报叫:",
          "multiple": 0,
          "maxCell": 2,
          "offset": 400,
          "param": "baojiaoCondition",
          "config": [
            {
              "name": "比起胡分数少100分",
              "value": 1,
              "default": 1,
              "wenhao": "如起胡选300分，200分可报叫"
            },
            {
              "name": "与起胡分数一样",
              "value": 2,
              "default": 0,
              "wenhao": "如起胡选300分，需要300分才能报叫"
            },
            {
              "name": "翻1番后达到起胡分数",
              "value": 3,
              "default": 0,
              "wenhao": "如起胡选300分，报叫翻一番，那么200分就可报叫"
            }
          ]
        },
        "config_fanbaipi": {
          "name": "翻白皮:",
          "multiple": 0,
          "maxCell": 2,
          "offset": 400,
          "param": "baipiType",
          "config": [
            {
              "name": "直接摸上手",
              "value": 1,
              "default": 1
            },
            {
              "name": "不上手只能自己用",
              "value": 2,
              "default": 0,
              "wenhao": "只能自己偷、吃、碰、杠、胡等，其他人不能"
            },
            {
              "name": "不上手大家都可以用",
              "value": 3,
              "default": 0,
              "wenhao": "自己和其他家都可以偷、吃、碰、杠、胡等"
            }
          ]
        },
        "config_fengding": {
          "name": "封顶:",
          "multiple": 0,
          "maxCell": 4,
          "param": "maxFan",
          "config": [
            {
              "name": "不封顶",
              "value": 99,
              "default": 1
            },
            {
              "name": "2番",
              "value": 2,
              "default": 0
            },
            {
              "name": "3番",
              "value": 3,
              "default": 0
            },
            {
              "name": "4番",
              "value": 4,
              "default": 0
            }
          ]
        },
        "config_playmethod": {
          "name": "玩法:",
          "multiple": 1,
          "maxCell": 3,
          "offset": 250,
          "config": [
            {
              "name": "全兴",
              "value": "quanXing",
              "default": 1,
              "wenhao": "7和王可偷可不偷，7和王可打，7和王可胡"
            },
            {
              "name": "海底捞",
              "value": "haiDiLao",
              "default": 0,
              "wenhao": "最后一张牌胡牌"
            },
            {
              "name": "258加番",
              "value": "jiaFan_258",
              "default": 0,
              "wenhao": "碰258算1番，杠258算2番"
            },
            {
              "name": "双进双出",
              "value": "doubleInOut",
              "default": 0,
              "wenhao": "双王和四个七输赢双方加1番"
            },
            {
              "name": "头炮算一番",
              "value": "diHu",
              "default": 0
            },
            {
              "name": "碰凑胡算1番",
              "value": "cheLong",
              "default": 1,
              "wenhao": "偷牌自摸算一番"
            }
          ]
        },
        "config_location": {
          "name": "定位:",
          "multiple": 1,
          "maxCell": 3,
          "config": [
            {
              "name": "开启GPS定位",
              "value": "openGps",
              "default": 0
            }
          ]
        }
      }
    }
  ],
  "12": [
    {
      "name": "小金斗十四",
      "gameId": 12,
      "rule": {
        "config_pay": {
          "name": "房费:",
          "multiple": 0,
          "maxCell": 3,
          "param": "useCardType",
          "config": [
            {
              "name": "AA",
              "value": 2,
              "default": 1,
              "wenhao": "所有人均摊"
            },
            {
              "name": "房主",
              "value": 1,
              "default": 0,
              "wenhao": "由创建房间玩家一人承担"
            }
          ]
        },
        "config_count": {
          "name": "局数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "gameNum",
          "config": [
            {
              "name": "4局",
              "value": 4,
              "default": 1
            },
            {
              "name": "8局",
              "value": 8,
              "default": 0
            },
            {
              "name": "12局",
              "value": 12,
              "default": 0
            }
          ]
        },
        "config_players": {
          "name": "人数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "playerNum",
          "config": [
            {
              "name": "2人",
              "value": 2,
              "default": 0
            },
            {
              "name": "3人",
              "value": 3,
              "default": 0
            },
            {
              "name": "4人",
              "value": 4,
              "default": 1
            }
          ]
        },
        "config_redScore": {
          "name": "胡牌:",
          "multiple": 0,
          "maxCell": 3,
          "param": "huRedScore",
          "config": [
            {
              "name": "300分",
              "value": 300,
              "default": 1
            },
            {
              "name": "400分",
              "value": 400,
              "default": 0
            },
            {
              "name": "500分",
              "value": 500,
              "default": 0
            }
          ]
        },
        "config_baojiao": {
          "name": "报叫:",
          "multiple": 0,
          "maxCell": 2,
          "offset": 400,
          "param": "baojiaoCondition",
          "config": [
            {
              "name": "比起胡分数少100分",
              "value": 1,
              "default": 1,
              "wenhao": "如起胡选300分，200分可报叫"
            },
            {
              "name": "与起胡分数一样",
              "value": 2,
              "default": 0,
              "wenhao": "如起胡选300分，需要300分才能报叫"
            },
            {
              "name": "翻1番后达到起胡分数",
              "value": 3,
              "default": 0,
              "wenhao": "如起胡选300分，报叫翻一番，那么200分就可报叫"
            }
          ]
        },
        "config_fanbaipi": {
          "name": "翻白皮:",
          "multiple": 0,
          "maxCell": 2,
          "offset": 400,
          "param": "baipiType",
          "config": [
            {
              "name": "直接摸上手",
              "value": 1,
              "default": 1
            },
            {
              "name": "不上手只能自己用",
              "value": 2,
              "default": 0,
              "wenhao": "只能自己偷、吃、碰、杠、胡等，其他人不能"
            },
            {
              "name": "不上手大家都可以用",
              "value": 3,
              "default": 0,
              "wenhao": "自己和其他家都可以偷、吃、碰、杠、胡等"
            }
          ]
        },
        "config_fengding": {
          "name": "封顶:",
          "multiple": 0,
          "maxCell": 4,
          "param": "maxFan",
          "config": [
            {
              "name": "不封顶",
              "value": 99,
              "default": 1
            },
            {
              "name": "2番",
              "value": 2,
              "default": 0
            },
            {
              "name": "3番",
              "value": 3,
              "default": 0
            },
            {
              "name": "4番",
              "value": 4,
              "default": 0
            }
          ]
        },
        "config_playmethod": {
          "name": "玩法:",
          "multiple": 1,
          "maxCell": 3,
          "offset": 250,
          "config": [
            {
              "name": "海底捞",
              "value": "haiDiLao",
              "default": 0,
              "wenhao": "最后一张牌胡牌"
            },
            {
              "name": "258加番",
              "value": "jiaFan_258",
              "default": 0,
              "wenhao": "碰258算1番，杠258算2番"
            },
            {
              "name": "双进双出",
              "value": "doubleInOut",
              "default": 0,
              "wenhao": "双王和四个七输赢双方加1番"
            },
            {
              "name": "头炮算一番",
              "value": "diHu",
              "default": 0
            },
            {
              "name": "碰凑胡算1番",
              "value": "cheLong",
              "default": 1,
              "wenhao": "偷牌自摸算一番"
            }
          ]
        },
        "config_location": {
          "name": "定位:",
          "multiple": 1,
          "maxCell": 3,
          "config": [
            {
              "name": "开启GPS定位",
              "value": "openGps",
              "default": 0
            }
          ]
        }
      }
    }
  ],
  "13": [
    {
      "name": "平昌扯坨",
      "gameId": 13,
      "rule": {
        "config_pay": {
          "name": "房费:",
          "multiple": 0,
          "maxCell": 3,
          "param": "useCardType",
          "config": [
            {
              "name": "AA",
              "value": 2,
              "default": 1,
              "wenhao": "所有人均摊"
            },
            {
              "name": "房主",
              "value": 1,
              "default": 0,
              "wenhao": "由创建房间玩家一人承担"
            }
          ]
        },
        "config_count": {
          "name": "局数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "gameNum",
          "config": [
            {
              "name": "4局",
              "value": 4,
              "default": 1
            },
            {
              "name": "8局",
              "value": 8,
              "default": 0
            },
            {
              "name": "12局",
              "value": 12,
              "default": 0
            }
          ]
        },
        "config_players": {
          "name": "人数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "playerNum",
          "config": [
            {
              "name": "2人",
              "value": 2,
              "default": 0
            },
            {
              "name": "3人",
              "value": 3,
              "default": 1
            },
            {
              "name": "4人",
              "value": 4,
              "default": 0
            }
          ]
        },
        "config_wang": {
          "name": "王数:",
          "multiple": 0,
          "maxCell": 4,
          "param": "wangNum",
          "config": [
            {
              "name": "0",
              "value": 0,
              "default": 0
            },
            {
              "name": "2",
              "value": 2,
              "default": 1
            },
            {
              "name": "3",
              "value": 3,
              "default": 0
            },
            {
              "name": "4",
              "value": 4,
              "default": 0
            },
            {
              "name": "5",
              "value": 5,
              "default": 0
            },
            {
              "name": "6",
              "value": 6,
              "default": 0
            }
          ]
        },
        "config_redScore": {
          "name": "胡牌:",
          "multiple": 0,
          "maxCell": 3,
          "param": "zhuang8Xian7",
          "config": [
            {
              "name": "庄8坨闲7坨",
              "value": 1,
              "default": 1
            },
            {
              "name": "庄7坨闲6坨",
              "value": 0,
              "default": 0
            }
          ]
        },
        "config_fengding": {
          "name": "封顶:",
          "multiple": 0,
          "maxCell": 4,
          "param": "maxFan",
          "config": [
            {
              "name": "不封顶",
              "value": 99,
              "default": 1
            },
            {
              "name": "2番",
              "value": 2,
              "default": 0
            },
            {
              "name": "3番",
              "value": 3,
              "default": 0
            },
            {
              "name": "4番",
              "value": 4,
              "default": 0
            }
          ]
        },
        "config_fan": {
          "name": "算分:",
          "maxCell": 3,
          "offset": 350,
          "multiple": 0,
          "param": "chengFan",
          "config": [
            {
              "name": "滚翻(番相乘)",
              "value": 1,
              "default": 1,
              "wenhao": "1*2(各番数之和)，如4番就是16分"
            },
            {
              "name": "梯翻(番相加)",
              "value": 0,
              "default": 0,
              "wenhao": "1+所有番数，如4番算5分"
            }
          ]
        },
        "config_playmethod": {
          "name": "玩法:",
          "multiple": 1,
          "maxCell": 3,
          "offset": 250,
          "config": [
            {
              "name": "放炮包赔",
              "value": "dianpaoBaopei",
              "default": 1
            },
            {
              "name": "自摸算1番",
              "value": "zimoJiafan",
              "default": 1,
              "wenhao": "自己番到胡牌"
            },
            {
              "name": "过庄",
              "value": "guoZhuang",
              "default": 1
            },
            {
              "name": "四归一",
              "value": "siGuiYi",
              "default": 1,
              "wenhao": "不是杠，胡牌中能凑够四同张的加1番"
            },
            {
              "name": "炸",
              "value": "zha",
              "default": 1
            },
            {
              "name": "对子加顺子",
              "value": "duiziShunzi",
              "default": 1
            }
          ]
        },
        "config_location": {
          "name": "定位:",
          "multiple": 1,
          "maxCell": 3,
          "config": [
            {
              "name": "开启GPS定位",
              "value": "openGps",
              "default": 0
            }
          ]
        }
      }
    }
  ],
  "14": [
    {
      "name": "汶川斗十四",
      "gameId": 14,
      "rule": {
        "config_pay": {
          "name": "房费:",
          "multiple": 0,
          "maxCell": 3,
          "param": "useCardType",
          "config": [
            {
              "name": "AA",
              "value": 2,
              "default": 1,
              "wenhao": "所有人均摊"
            },
            {
              "name": "房主",
              "value": 1,
              "default": 0,
              "wenhao": "由创建房间玩家一人承担"
            }
          ]
        },
        "config_count": {
          "name": "局数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "gameNum",
          "config": [
            {
              "name": "4局",
              "value": 4,
              "default": 1
            },
            {
              "name": "8局",
              "value": 8,
              "default": 0
            },
            {
              "name": "12局",
              "value": 12,
              "default": 0
            }
          ]
        },
        "config_fengding": {
          "name": "封顶:",
          "multiple": 0,
          "maxCell": 4,
          "param": "maxFan",
          "config": [
            {
              "name": "不封顶",
              "value": 99,
              "default": 1
            },
            {
              "name": "3番",
              "value": 3,
              "default": 0
            },
            {
              "name": "4番",
              "value": 4,
              "default": 0
            },
            {
              "name": "5番",
              "value": 5,
              "default": 0
            }
          ]
        },
        "config_playmethod": {
          "name": "玩法:",
          "multiple": 1,
          "maxCell": 3,
          "offset": 250,
          "config": [
            {
              "name": "258加番",
              "value": "jiaFan_258",
              "default": 1,
              "wenhao": "碰258算1番，杠258算2番"
            },
            {
              "name": "扯凑胡",
              "value": "cheLong",
              "default": 1,
              "wenhao": "偷牌自摸算一番"
            },
            {
              "name": "报叫",
              "value": "baoJiao",
              "default": 1
            },
            {
              "name": "四归一",
              "value": "siGuiYi",
              "default": 1,
              "wenhao": "不是杠，胡牌中能凑够四同张的加1番"
            },
            {
              "name": "1000分以上加1番",
              "value": "qianfenJiafan",
              "default": 0
            }
          ]
        },
        "config_location": {
          "name": "定位:",
          "multiple": 1,
          "maxCell": 3,
          "config": [
            {
              "name": "开启GPS定位",
              "value": "openGps",
              "default": 0
            }
          ]
        }
      }
    }
  ],
  "15": [
    {
      "name": "茂县斗十四",
      "gameId": 15,
      "rule": {
        "config_pay": {
          "name": "房费:",
          "multiple": 0,
          "maxCell": 3,
          "param": "useCardType",
          "config": [
            {
              "name": "AA",
              "value": 2,
              "default": 1,
              "wenhao": "所有人均摊"
            },
            {
              "name": "房主",
              "value": 1,
              "default": 0,
              "wenhao": "由创建房间玩家一人承担"
            }
          ]
        },
        "config_count": {
          "name": "局数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "gameNum",
          "config": [
            {
              "name": "4局",
              "value": 4,
              "default": 1
            },
            {
              "name": "8局",
              "value": 8,
              "default": 0
            },
            {
              "name": "12局",
              "value": 12,
              "default": 0
            }
          ]
        },
        "config_fengding": {
          "name": "封顶:",
          "multiple": 0,
          "maxCell": 4,
          "param": "maxFan",
          "config": [
            {
              "name": "不封顶",
              "value": 99,
              "default": 1
            },
            {
              "name": "3番",
              "value": 3,
              "default": 0
            },
            {
              "name": "4番",
              "value": 4,
              "default": 0
            },
            {
              "name": "5番",
              "value": 5,
              "default": 0
            }
          ]
        },
        "config_playmethod": {
          "name": "玩法:",
          "multiple": 1,
          "maxCell": 3,
          "offset": 250,
          "config": [
            {
              "name": "258加番",
              "value": "jiaFan_258",
              "default": 0,
              "wenhao": "碰258算1番，杠258算2番"
            },
            {
              "name": "扯凑胡",
              "value": "cheLong",
              "default": 1,
              "wenhao": "偷牌自摸算一番"
            },
            {
              "name": "报叫",
              "value": "baoJiao",
              "default": 1,
              "wenhao": "起手有无红20点下叫，输赢50分"
            },
            {
              "name": "四归一",
              "value": "siGuiYi",
              "default": 0,
              "wenhao": "不是杠，胡牌中能凑够四同张的加1番"
            },
            {
              "name": "1000分以上加1番",
              "value": "qianfenJiafan",
              "default": 0,
              "wenhao": "碰258算1番，杠258算2番"
            }
          ]
        },
        "config_location": {
          "name": "定位:",
          "multiple": 1,
          "maxCell": 3,
          "config": [
            {
              "name": "开启GPS定位",
              "value": "openGps",
              "default": 0
            }
          ]
        }
      }
    }
  ],
  "16": [
    {
      "name": "遂宁斗十四",
      "gameId": 16,
      "rule": {
        "config_pay": {
          "name": "房费:",
          "multiple": 0,
          "maxCell": 3,
          "param": "useCardType",
          "config": [
            {
              "name": "AA",
              "value": 2,
              "default": 1,
              "wenhao": "所有人均摊"
            },
            {
              "name": "房主",
              "value": 1,
              "default": 0,
              "wenhao": "由创建房间玩家一人承担"
            }
          ]
        },
        "config_count": {
          "name": "局数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "gameNum",
          "config": [
            {
              "name": "4局",
              "value": 4,
              "default": 1
            },
            {
              "name": "8局",
              "value": 8,
              "default": 0
            },
            {
              "name": "12局",
              "value": 12,
              "default": 0
            }
          ]
        },
        "config_players": {
          "name": "人数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "playerNum",
          "config": [
            {
              "name": "2人",
              "value": 2,
              "default": 0
            },
            {
              "name": "3人",
              "value": 3,
              "default": 0
            },
            {
              "name": "4人",
              "value": 4,
              "default": 1
            }
          ]
        },
        "config_redScore": {
          "name": "胡牌:",
          "multiple": 0,
          "maxCell": 3,
          "param": "huRedScore",
          "config": [
            {
              "name": "300分",
              "value": 300,
              "default": 1
            },
            {
              "name": "400分",
              "value": 400,
              "default": 0
            }
          ]
        },
        "config_playmethod": {
          "name": "玩法:",
          "multiple": 1,
          "maxCell": 3,
          "offset": 250,
          "config": [
            {
              "name": "自摸算1番",
              "value": "zimoJiafan",
              "default": 1
            },
            {
              "name": "地胡1番",
              "value": "diHu",
              "default": 0
            },
            {
              "name": "天胡1番",
              "value": "tianHu",
              "default": 0
            },
            {
              "name": "杠上花2番",
              "value": "gangHua",
              "default": 0,
              "wenhao": "杠上花、扯牌后偷牌自摸、翻王偷牌自摸"
            },
            {
              "name": "自翻自吃",
              "value": "ziChi",
              "default": 0
            }
          ]
        },
        "config_location": {
          "name": "定位:",
          "multiple": 1,
          "maxCell": 3,
          "config": [
            {
              "name": "开启GPS定位",
              "value": "openGps",
              "default": 0
            }
          ]
        }
      }
    }
  ],
  "17": [
    {
      "name": "理塘红斗",
      "gameId": 17,
      "rule": {
        "config_pay": {
          "name": "房费:",
          "multiple": 0,
          "maxCell": 3,
          "param": "useCardType",
          "config": [
            {
              "name": "AA",
              "value": 2,
              "default": 1,
              "wenhao": "所有人均摊"
            },
            {
              "name": "房主",
              "value": 1,
              "default": 0,
              "wenhao": "由创建房间玩家一人承担"
            }
          ]
        },
        "config_count": {
          "name": "局数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "gameNum",
          "config": [
            {
              "name": "4局",
              "value": 4,
              "default": 1
            },
            {
              "name": "8局",
              "value": 8,
              "default": 0
            },
            {
              "name": "12局",
              "value": 12,
              "default": 0
            }
          ]
        },
        "config_players": {
          "name": "人数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "playerNum",
          "config": [
            {
              "name": "2人",
              "value": 2,
              "default": 0
            },
            {
              "name": "3人",
              "value": 3,
              "default": 0
            },
            {
              "name": "4人",
              "value": 4,
              "default": 1
            }
          ]
        },
        "config_playmethod": {
          "name": "玩法:",
          "multiple": 1,
          "maxCell": 3,
          "offset": 250,
          "config": [
            {
              "name": "金二十3抽",
              "value": "qia20",
              "default": 1
            },
            {
              "name": "金五十10抽",
              "value": "qia50",
              "default": 1
            },
            {
              "name": "红五十5抽",
              "value": "hongHei_50",
              "default": 1
            },
            {
              "name": "全红.全黑3抽",
              "value": "quanHongHei",
              "default": 1
            },
            {
              "name": "海底捞3抽",
              "value": "haiDiLao",
              "default": 1
            },
            {
              "name": "全大.全小.全烂3抽",
              "value": "quanDaXiaoLan",
              "default": 1
            }
          ]
        },
        "config_location": {
          "name": "定位:",
          "multiple": 1,
          "maxCell": 3,
          "config": [
            {
              "name": "开启GPS定位",
              "value": "openGps",
              "default": 0
            }
          ]
        }
      }
    }
  ],
  "18": [
    {
      "name": "广元割胡",
      "gameId": 18,
      "rule": {
        "config_pay": {
          "name": "房费:",
          "multiple": 0,
          "maxCell": 3,
          "param": "useCardType",
          "config": [
            {
              "name": "AA",
              "value": 2,
              "default": 1,
              "wenhao": "所有人均摊"
            },
            {
              "name": "房主",
              "value": 1,
              "default": 0,
              "wenhao": "由创建房间玩家一人承担"
            }
          ]
        },
        "config_count": {
          "name": "局数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "gameNum",
          "config": [
            {
              "name": "4局",
              "value": 4,
              "default": 1
            },
            {
              "name": "8局",
              "value": 8,
              "default": 0
            },
            {
              "name": "12局",
              "value": 12,
              "default": 0
            }
          ]
        },
        "config_players": {
          "name": "人数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "playerNum",
          "config": [
            {
              "name": "2人",
              "value": 2,
              "default": 0
            },
            {
              "name": "3人",
              "value": 3,
              "default": 1
            },
            {
              "name": "4人",
              "value": 4,
              "default": 0
            }
          ]
        },
        "config_fengding": {
          "name": "封顶:",
          "multiple": 0,
          "maxCell": 4,
          "param": "maxFan",
          "config": [
            {
              "name": "不封顶",
              "value": 99,
              "default": 0
            },
            {
              "name": "5番",
              "value": 5,
              "default": 0
            },
            {
              "name": "6番",
              "value": 6,
              "default": 0
            },
            {
              "name": "7番",
              "value": 7,
              "default": 1
            }
          ]
        },
        "config_redScore": {
          "name": "起胡:",
          "multiple": 0,
          "maxCell": 3,
          "param": "huRedScore",
          "config": [
            {
              "name": "300分",
              "value": 300,
              "default": 1
            },
            {
              "name": "400分",
              "value": 400,
              "default": 0
            },
            {
              "name": "500分",
              "value": 500,
              "default": 0
            }
          ]
        },
        "config_playmethod": {
          "name": "玩法:",
          "multiple": 1,
          "maxCell": 3,
          "offset": 250,
          "config": [
            {
              "name": "258加番",
              "value": "jiaFan_258",
              "default": 1,
              "wenhao": "碰258算1番，杠258算2番"
            },
            {
              "name": "扯凑胡",
              "value": "cheLong",
              "default": 1,
              "wenhao": "偷牌自摸算一番"
            },
            {
              "name": "报叫",
              "value": "baoJiao",
              "default": 1
            },
            {
              "name": "四归一",
              "value": "siGuiYi",
              "default": 1,
              "wenhao": "不是杠，胡牌中能凑够四同张的加1番"
            },
            {
              "name": "天胡2番",
              "value": "tianHu",
              "default": 1
            },
            {
              "name": "地胡1番",
              "value": "diHu",
              "default": 0,
              "wenhao": "闲加胡庄家打出的第一张牌"
            }
          ]
        },
        "config_location": {
          "name": "定位:",
          "multiple": 1,
          "maxCell": 3,
          "config": [
            {
              "name": "开启GPS定位",
              "value": "openGps",
              "default": 0
            }
          ]
        }
      }
    }
  ],
  "19": [
    {
      "name": "通江斗十四",
      "gameId": 19,
      "rule": {
        "config_pay": {
          "name": "房费:",
          "multiple": 0,
          "maxCell": 3,
          "param": "useCardType",
          "config": [
            {
              "name": "AA",
              "value": 2,
              "default": 1,
              "wenhao": "所有人均摊"
            },
            {
              "name": "房主",
              "value": 1,
              "default": 0,
              "wenhao": "由创建房间玩家一人承担"
            }
          ]
        },
        "config_count": {
          "name": "局数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "gameNum",
          "config": [
            {
              "name": "4局",
              "value": 4,
              "default": 1
            },
            {
              "name": "8局",
              "value": 8,
              "default": 0
            },
            {
              "name": "12局",
              "value": 12,
              "default": 0
            }
          ]
        },
        "config_players": {
          "name": "人数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "playerNum",
          "config": [
            {
              "name": "2人",
              "value": 2,
              "default": 0
            },
            {
              "name": "3人",
              "value": 3,
              "default": 0
            },
            {
              "name": "4人",
              "value": 4,
              "default": 1
            }
          ]
        },
        "config_redScore": {
          "name": "胡牌:",
          "multiple": 0,
          "maxCell": 3,
          "param": "huRedScore",
          "config": [
            {
              "name": "300分",
              "value": 300,
              "default": 0
            },
            {
              "name": "400分",
              "value": 400,
              "default": 1
            },
            {
              "name": "500分",
              "value": 500,
              "default": 0
            }
          ]
        },
        "config_playmethod": {
          "name": "玩法:",
          "multiple": 1,
          "maxCell": 3,
          "offset": 250,
          "config": [
            {
              "name": "258加番",
              "value": "jiaFan_258",
              "default": 1,
              "wenhao": "碰258算1番，杠258算2番"
            },
            {
              "name": "报叫",
              "value": "baoJiao",
              "default": 1
            },
            {
              "name": "天胡",
              "value": "tianHu",
              "default": 1
            }
          ]
        },
        "config_location": {
          "name": "定位:",
          "multiple": 1,
          "maxCell": 3,
          "config": [
            {
              "name": "开启GPS定位",
              "value": "openGps",
              "default": 0
            }
          ]
        }
      }
    }
  ],
  "20": [
    {
      "name": "荣县斗十四",
      "gameId": 20,
      "rule": {
        "config_pay": {
          "name": "房费:",
          "multiple": 0,
          "maxCell": 3,
          "param": "useCardType",
          "config": [
            {
              "name": "AA",
              "value": 2,
              "default": 1,
              "wenhao": "所有人均摊"
            },
            {
              "name": "房主",
              "value": 1,
              "default": 0,
              "wenhao": "由创建房间玩家一人承担"
            }
          ]
        },
        "config_count": {
          "name": "局数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "gameNum",
          "config": [
            {
              "name": "4局",
              "value": 4,
              "default": 0
            },
            {
              "name": "8局",
              "value": 8,
              "default": 1
            },
            {
              "name": "12局",
              "value": 12,
              "default": 0
            }
          ]
        },
        "config_players": {
          "name": "人数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "playerNum",
          "config": [
            {
              "name": "2人",
              "value": 2,
              "default": 0
            },
            {
              "name": "3人",
              "value": 3,
              "default": 0
            },
            {
              "name": "4人",
              "value": 4,
              "default": 1
            }
          ]
        },
        "config_fengding": {
          "name": "封顶:",
          "multiple": 0,
          "maxCell": 4,
          "param": "maxFan",
          "config": [
            {
              "name": "不封顶",
              "value": 99,
              "default": 0
            },
            {
              "name": "3番",
              "value": 3,
              "default": 1
            },
            {
              "name": "4番",
              "value": 4,
              "default": 0
            },
            {
              "name": "5番",
              "value": 5,
              "default": 0
            }
          ]
        },
        "config_chaofan": {
          "name": "\n超番\n加底:",
          "multiple": 0,
          "maxCell": 4,
          "param": "chaoFanJiaDi",
          "config": [
            {
              "name": "0",
              "value": 0,
              "default": 0
            },
            {
              "name": "1",
              "value": 1,
              "default": 1
            },
            {
              "name": "2",
              "value": 2,
              "default": 0
            },
            {
              "name": "5",
              "value": 5,
              "default": 0
            },
            {
              "name": "10",
              "value": 10,
              "default": 0
            }
          ]
        },
        "config_wang": {
          "name": "癞子:",
          "multiple": 0,
          "maxCell": 4,
          "param": "wangNum",
          "config": [
            {
              "name": "0",
              "value": 0,
              "default": 0
            },
            {
              "name": "1",
              "value": 1,
              "default": 0
            },
            {
              "name": "2",
              "value": 2,
              "default": 1
            },
            {
              "name": "3",
              "value": 3,
              "default": 0
            },
            {
              "name": "4",
              "value": 4,
              "default": 0
            },
            {
              "name": "5",
              "value": 5,
              "default": 0
            },
            {
              "name": "6",
              "value": 6,
              "default": 0
            },
            {
              "name": "8",
              "value": 8,
              "default": 0
            }
          ]
        },
        "config_daxiaojia": {
          "name": "小家:",
          "multiple": 0,
          "maxCell": 3,
          "param": "daXiaoJia",
          "config": [
            {
              "name": "打",
              "value": 1,
              "default": 1,
              "wenhao": "尾家5张牌，翻牌时不翻开直接摸上手"
            },
            {
              "name": "不打",
              "value": 0,
              "default": 0,
              "wenhao": "起手7张牌，翻牌"
            }
          ]
        },
        "config_playmethod": {
          "name": "玩法:",
          "multiple": 1,
          "maxCell": 3,
          "offset": 250,
          "config": [
            {
              "name": "天胡可以偷牌",
              "value": "tianHuKeTou",
              "default": 1,
              "wenhao": "庄家起手偷牌后胡牌算天胡"
            }
          ]
        },
        "config_location": {
          "name": "定位:",
          "multiple": 1,
          "maxCell": 3,
          "config": [
            {
              "name": "开启GPS定位",
              "value": "openGps",
              "default": 0
            }
          ]
        }
      }
    }
  ],
  "21": [
    {
      "name": "越西斗十四",
      "gameId": 21,
      "rule": {
        "config_pay": {
          "name": "房费:",
          "multiple": 0,
          "maxCell": 3,
          "param": "useCardType",
          "config": [
            {
              "name": "AA",
              "value": 2,
              "default": 1,
              "wenhao": "所有人均摊"
            },
            {
              "name": "房主",
              "value": 1,
              "default": 0,
              "wenhao": "由创建房间玩家一人承担"
            }
          ]
        },
        "config_count": {
          "name": "局数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "gameNum",
          "config": [
            {
              "name": "4局",
              "value": 4,
              "default": 0
            },
            {
              "name": "8局",
              "value": 8,
              "default": 1
            },
            {
              "name": "12局",
              "value": 12,
              "default": 0
            }
          ]
        },
        "config_players": {
          "name": "人数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "playerNum",
          "config": [
            {
              "name": "2人",
              "value": 2,
              "default": 0
            },
            {
              "name": "3人",
              "value": 3,
              "default": 0
            },
            {
              "name": "4人",
              "value": 4,
              "default": 1
            }
          ]
        },
        "config_fengding": {
          "name": "封顶:",
          "multiple": 0,
          "maxCell": 4,
          "param": "maxFan",
          "config": [
            {
              "name": "不封顶",
              "value": 99,
              "default": 0
            },
            {
              "name": "5番",
              "value": 5,
              "default": 1
            },
            {
              "name": "6番",
              "value": 6,
              "default": 0
            },
            {
              "name": "7番",
              "value": 7,
              "default": 0
            }
          ]
        },
        "config_laizi": {
          "name": "癞子:",
          "multiple": 0,
          "maxCell": 3,
          "param": "wangToTingyong",
          "config": [
            {
              "name": "打",
              "value": 1,
              "default": 0,
              "wenhao": "大小王和白皮当癞子，当万能牌用"
            },
            {
              "name": "不打",
              "value": 0,
              "default": 1,
              "wenhao": "大小王和白皮直接偷牌，每张算1番"
            }
          ]
        },
        "config_playmethod": {
          "name": "玩法:",
          "multiple": 1,
          "maxCell": 3,
          "offset": 250,
          "config": [
            {
              "name": "庄家打一张可胡",
              "value": "diHuChuDiyizhang",
              "default": 0,
              "wenhao": "庄家打出第一张可以地胡算3番"
            }
          ]
        },
        "config_location": {
          "name": "定位:",
          "multiple": 1,
          "maxCell": 3,
          "config": [
            {
              "name": "开启GPS定位",
              "value": "openGps",
              "default": 0
            }
          ]
        }
      }
    }
  ],
  "22": [
    {
      "name": "盐津斗十四",
      "gameId": 22,
      "rule": {
        "config_pay": {
          "name": "房费:",
          "multiple": 0,
          "maxCell": 3,
          "param": "useCardType",
          "config": [
            {
              "name": "AA",
              "value": 2,
              "default": 1,
              "wenhao": "所有人均摊"
            },
            {
              "name": "房主",
              "value": 1,
              "default": 0,
              "wenhao": "由创建房间玩家一人承担"
            }
          ]
        },
        "config_count": {
          "name": "局数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "gameNum",
          "config": [
            {
              "name": "4局",
              "value": 4,
              "default": 0
            },
            {
              "name": "8局",
              "value": 8,
              "default": 1
            },
            {
              "name": "12局",
              "value": 12,
              "default": 0
            }
          ]
        },
        "config_players": {
          "name": "人数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "playerNum",
          "config": [
            {
              "name": "2人",
              "value": 2,
              "default": 0
            },
            {
              "name": "3人",
              "value": 3,
              "default": 0
            },
            {
              "name": "4人",
              "value": 4,
              "default": 1
            }
          ]
        },
        "config_siCaiErJing": {
          "name": "彩电:",
          "multiple": 0,
          "maxCell": 3,
          "param": "siCaiErJing",
          "config": [
            {
              "name": "3个",
              "value": 0,
              "default": 1,
              "wenhao": "大小王和白皮当彩电"
            },
            {
              "name": "四彩二精",
              "value": 1,
              "default": 0,
              "wenhao": "四个七当彩电，大小王当精直接沉，每张算一番"
            }
          ]
        },
        "config_playmethod": {
          "name": "玩法:",
          "multiple": 1,
          "maxCell": 3,
          "offset": 250,
          "config": [
            {
              "name": "自摸加倍",
              "value": "zimoJiafan",
              "default": 1
            },
            {
              "name": "红黑胡各两番",
              "value": "quanHongHei",
              "default": 1
            },
            {
              "name": "彩电可以接炮",
              "value": "tingyongHuDaFan",
              "default": 1,
              "wenhao": "彩电除了胡翻的牌还可以胡打的牌"
            },
            {
              "name": "大全红",
              "value": "daQuanHong",
              "default": 1,
              "wenhao": "至少红25点才能胡牌，不勾选表示小全红，不需要红25点也能胡"
            },
            {
              "name": "放炮包赔",
              "value": "dianpaoBaopei",
              "default": 0
            },
            {
              "name": "天地胡各两番",
              "value": "tianHu",
              "default": 0
            },
            {
              "name": "巧二十五两番",
              "value": "qia25",
              "default": 0,
              "wenhao": "刚好25点"
            }
          ]
        },
        "config_location": {
          "name": "定位:",
          "multiple": 1,
          "maxCell": 3,
          "config": [
            {
              "name": "开启GPS定位",
              "value": "openGps",
              "default": 0
            }
          ]
        }
      }
    }
  ],
  "23": [
    {
      "name": "叙州斗十四",
      "gameId": 23,
      "rule": {
        "config_pay": {
          "name": "房费:",
          "multiple": 0,
          "maxCell": 3,
          "param": "useCardType",
          "config": [
            {
              "name": "AA",
              "value": 2,
              "default": 1,
              "wenhao": "所有人均摊"
            },
            {
              "name": "房主",
              "value": 1,
              "default": 0,
              "wenhao": "由创建房间玩家一人承担"
            }
          ]
        },
        "config_count": {
          "name": "局数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "gameNum",
          "config": [
            {
              "name": "4局",
              "value": 4,
              "default": 1
            },
            {
              "name": "8局",
              "value": 8,
              "default": 0
            },
            {
              "name": "12局",
              "value": 12,
              "default": 0
            }
          ]
        },
        "config_players": {
          "name": "人数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "playerNum",
          "config": [
            {
              "name": "2人",
              "value": 2,
              "default": 0
            },
            {
              "name": "3人",
              "value": 3,
              "default": 0
            },
            {
              "name": "4人",
              "value": 4,
              "default": 1
            }
          ]
        },
        "config_fengding": {
          "name": "封顶:",
          "multiple": 0,
          "maxCell": 4,
          "param": "maxFan",
          "config": [
            {
              "name": "不封顶",
              "value": 99,
              "default": 1
            },
            {
              "name": "4番",
              "value": 4,
              "default": 0
            },
            {
              "name": "5番",
              "value": 5,
              "default": 0
            },
            {
              "name": "6番",
              "value": 6,
              "default": 0
            }
          ]
        },
        "config_piao": {
          "name": "漂",
          "multiple": 0,
          "maxCell": 3,
          "param": "piaoType",
          "config": [
            {
              "name": "不漂",
              "value": 0,
              "default": 1
            },
            {
              "name": "漂一个算1番",
              "value": 2,
              "default": 0
            }
          ]
        },
        "config_wang": {
          "name": "癞子:",
          "multiple": 0,
          "maxCell": 4,
          "param": "wangNum",
          "config": [
            {
              "name": "0",
              "value": 0,
              "default": 1,
              "wenhao": "不打癞子，大小王和白皮直接偷牌，每张算1番"
            },
            {
              "name": "3",
              "value": 3,
              "default": 0,
              "wenhao": "大小王和白皮当万能牌用"
            },
            {
              "name": "4",
              "value": 4,
              "default": 0
            },
            {
              "name": "6",
              "value": 6,
              "default": 0
            }
          ]
        },
        "config_playmethod": {
          "name": "玩法:",
          "multiple": 1,
          "maxCell": 2,
          "offset": 400,
          "config": [
            {
              "name": "有巴必巴",
              "value": "baNoGuo",
              "default": 1,
              "wenhao": "除非与手上凑成十四，否则有巴必巴"
            },
            {
              "name": "过张不能吃碰",
              "value": "guoZhangNoCaozuo",
              "default": 1,
              "wenhao": "第一张不吃、不碰、第二张就不能吃碰了，除非动手牌"
            },
            {
              "name": "杠牌超过4张",
              "value": "gangDuoZhang",
              "default": 1,
              "wenhao": "不勾选表示杠牌最多四张，勾选表示可以有5张、6张及更多张数的杠牌"
            }
          ]
        },
        "config_location": {
          "name": "定位:",
          "multiple": 1,
          "maxCell": 3,
          "config": [
            {
              "name": "开启GPS定位",
              "value": "openGps",
              "default": 0
            }
          ]
        }
      }
    }
  ],
  "24": [
    {
      "name": "雷波斗十四",
      "gameId": 24,
      "rule": {
        "config_pay": {
          "name": "房费:",
          "multiple": 0,
          "maxCell": 3,
          "param": "useCardType",
          "config": [
            {
              "name": "AA",
              "value": 2,
              "default": 1,
              "wenhao": "所有人均摊"
            },
            {
              "name": "房主",
              "value": 1,
              "default": 0,
              "wenhao": "由创建房间玩家一人承担"
            }
          ]
        },
        "config_count": {
          "name": "局数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "gameNum",
          "config": [
            {
              "name": "4局",
              "value": 4,
              "default": 1
            },
            {
              "name": "8局",
              "value": 8,
              "default": 0
            },
            {
              "name": "12局",
              "value": 12,
              "default": 0
            }
          ]
        },
        "config_players": {
          "name": "人数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "playerNum",
          "config": [
            {
              "name": "2人",
              "value": 2,
              "default": 0
            },
            {
              "name": "3人",
              "value": 3,
              "default": 0
            },
            {
              "name": "4人",
              "value": 4,
              "default": 1
            }
          ]
        },
        "config_fengding": {
          "name": "封顶:",
          "multiple": 0,
          "maxCell": 4,
          "param": "maxFan",
          "config": [
            {
              "name": "不封顶",
              "value": 99,
              "default": 1
            },
            {
              "name": "3番",
              "value": 3,
              "default": 0
            },
            {
              "name": "4番",
              "value": 4,
              "default": 0
            },
            {
              "name": "5番",
              "value": 5,
              "default": 0
            }
          ]
        },
        "config_wang": {
          "name": "癞子:",
          "multiple": 0,
          "maxCell": 4,
          "param": "wangNum",
          "config": [
            {
              "name": "0",
              "value": 0,
              "default": 1,
              "wenhao": "不打癞子，大小王和白皮直接偷牌，每张算1番"
            },
            {
              "name": "3",
              "value": 3,
              "default": 0,
              "wenhao": "大小王和白皮当万能牌用"
            },
            {
              "name": "4",
              "value": 4,
              "default": 0
            },
            {
              "name": "6",
              "value": 6,
              "default": 0
            }
          ]
        },
        "config_playmethod": {
          "name": "玩法:",
          "multiple": 1,
          "maxCell": 2,
          "offset": 400,
          "config": [
            {
              "name": "红黑胡各2番",
              "value": "quanHongHei",
              "default": 1
            },
            {
              "name": "天地胡各2番",
              "value": "tianHu",
              "default": 1
            },
            {
              "name": "可抢胡手上去巴的牌",
              "value": "ownBaKeQiang",
              "default": 0
            }
          ]
        },
        "config_location": {
          "name": "定位:",
          "multiple": 1,
          "maxCell": 3,
          "config": [
            {
              "name": "开启GPS定位",
              "value": "openGps",
              "default": 0
            }
          ]
        }
      }
    }
  ],
  "25": [
    {
      "name": "筠连斗十四",
      "gameId": 25,
      "rule": {
        "config_pay": {
          "name": "房费:",
          "multiple": 0,
          "maxCell": 3,
          "param": "useCardType",
          "config": [
            {
              "name": "AA",
              "value": 2,
              "default": 1,
              "wenhao": "所有人均摊"
            },
            {
              "name": "房主",
              "value": 1,
              "default": 0,
              "wenhao": "由创建房间玩家一人承担"
            }
          ]
        },
        "config_count": {
          "name": "局数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "gameNum",
          "config": [
            {
              "name": "4局",
              "value": 4,
              "default": 1
            },
            {
              "name": "8局",
              "value": 8,
              "default": 0
            },
            {
              "name": "12局",
              "value": 12,
              "default": 0
            }
          ]
        },
        "config_players": {
          "name": "人数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "playerNum",
          "config": [
            {
              "name": "2人",
              "value": 2,
              "default": 0
            },
            {
              "name": "3人",
              "value": 3,
              "default": 0
            },
            {
              "name": "4人",
              "value": 4,
              "default": 1
            }
          ]
        },
        "config_wang": {
          "name": "听用:",
          "multiple": 0,
          "maxCell": 3,
          "param": "wangNum",
          "config": [
            {
              "name": "0",
              "value": 0,
              "default": 1,
              "wenhao": "不打"
            },
            {
              "name": "1",
              "value": 1,
              "default": 0,
              "wenhao": "白皮当听用"
            }
          ]
        },
        "config_qihu": {
          "name": "起胡:",
          "multiple": 0,
          "maxCell": 3,
          "param": "huRedScore",
          "config": [
            {
              "name": "红21点",
              "value": 21,
              "default": 1
            },
            {
              "name": "红25点",
              "value": 25,
              "default": 0
            }
          ]
        },
        "config_qifan": {
          "name": "起番:",
          "multiple": 0,
          "maxCell": 3,
          "param": "qiFanDianNum",
          "config": [
            {
              "name": "21点算1番",
              "value": 21,
              "default": 1
            },
            {
              "name": "25点算1番",
              "value": 25,
              "default": 0
            }
          ]
        },
        "config_duizi": {
          "name": "对子:",
          "multiple": 0,
          "maxCell": 3,
          "param": "anDuiFanNum",
          "config": [
            {
              "name": "明8暗6鸳10",
              "value": 6,
              "default": 1
            },
            {
              "name": "明15暗10鸳14",
              "value": 10,
              "default": 0
            }
          ]
        },
        "config_playmethod": {
          "name": "玩法:",
          "multiple": 1,
          "maxCell": 3,
          "offset": 300,
          "config": [
            {
              "name": "巧20算4番",
              "value": "qia20",
              "default": 1
            },
            {
              "name": "7红7黑",
              "value": "da_7hong_7hei",
              "default": 0
            },
            {
              "name": "一点朱",
              "value": "yiDianZhu",
              "default": 0
            },
            {
              "name": "全求人",
              "value": "quanQiuRen",
              "default": 0
            },
            {
              "name": "门清",
              "value": "menQing",
              "default": 0
            },
            {
              "name": "四张落地",
              "value": "siZhangLuoDi",
              "default": 0
            },
            {
              "name": "乱胡",
              "value": "luanHu",
              "default": 0
            },
            {
              "name": "抢7胡",
              "value": "qiang_7Hu",
              "default": 0
            },
            {
              "name": "大胡可杀",
              "value": "daShaQiangHu",
              "default": 0
            }
          ]
        },
        "config_location": {
          "name": "定位:",
          "multiple": 1,
          "maxCell": 3,
          "config": [
            {
              "name": "开启GPS定位",
              "value": "openGps",
              "default": 0
            }
          ]
        }
      }
    }
  ],
  "26": [
    {
      "name": "甘洛斗十四",
      "gameId": 26,
      "rule": {
        "config_pay": {
          "name": "房费:",
          "multiple": 0,
          "maxCell": 3,
          "param": "useCardType",
          "config": [
            {
              "name": "AA",
              "value": 2,
              "default": 1,
              "wenhao": "所有人均摊"
            },
            {
              "name": "房主",
              "value": 1,
              "default": 0,
              "wenhao": "由创建房间玩家一人承担"
            }
          ]
        },
        "config_count": {
          "name": "局数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "gameNum",
          "config": [
            {
              "name": "4局",
              "value": 4,
              "default": 1
            },
            {
              "name": "8局",
              "value": 8,
              "default": 0
            },
            {
              "name": "12局",
              "value": 12,
              "default": 0
            }
          ]
        },
        "config_players": {
          "name": "人数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "playerNum",
          "config": [
            {
              "name": "2人",
              "value": 2,
              "default": 0
            },
            {
              "name": "3人",
              "value": 3,
              "default": 0
            },
            {
              "name": "4人",
              "value": 4,
              "default": 1
            }
          ]
        },
        "config_wang": {
          "name": "王个数:",
          "multiple": 0,
          "maxCell": 3,
          "offset": 270,
          "param": "wangNum",
          "config": [
            {
              "name": "3个（一副牌）",
              "value": 3,
              "default": 1
            },
            {
              "name": "6个（两副牌）",
              "value": 6,
              "default": 0
            }
          ]
        },
        "config_qi": {
          "name": "七个数:",
          "multiple": 0,
          "maxCell": 3,
          "offset": 270,
          "param": "qiWangNum",
          "config": [
            {
              "name": "4个（一副牌）",
              "value": 4,
              "default": 0
            },
            {
              "name": "8个（两副牌）",
              "value": 8,
              "default": 1
            },
            {
              "name": "12个（三副牌）",
              "value": 12,
              "default": 0
            }
          ]
        },
        "config_fengding": {
          "name": "敲数\n封顶:",
          "multiple": 0,
          "maxCell": 4,
          "param": "maxFan",
          "config": [
            {
              "name": "3敲",
              "value": 3,
              "default": 0
            },
            {
              "name": "4敲",
              "value": 4,
              "default": 1
            },
            {
              "name": "5敲",
              "value": 5,
              "default": 0
            },
            {
              "name": "6敲",
              "value": 6,
              "default": 0
            }
          ]
        },
        "config_chaofan": {
          "name": "超顶\n加分:",
          "multiple": 0,
          "maxCell": 3,
          "offset": 280,
          "param": "chaoFanJiaDi",
          "config": [
            {
              "name": "每敲加1分",
              "value": 1,
              "default": 1,
              "wenhao": " 超出封顶每敲加1分"
            },
            {
              "name": "每敲加2分",
              "value": 2,
              "default": 0,
              "wenhao": "超出封顶每敲加2分"
            },
            {
              "name": "每敲加3分",
              "value": 3,
              "default": 0,
              "wenhao": "超出封顶每敲加3分"
            }
          ]
        },
        "config_playmethod": {
          "name": "玩法:",
          "multiple": 1,
          "maxCell": 3,
          "offset": 300,
          "config": [
            {
              "name": "红五十和黑五十",
              "value": "hongHei_50",
              "default": 1
            },
            {
              "name": "报叫2敲",
              "value": "baoJiao",
              "default": 1
            },
            {
              "name": "金二十1敲",
              "value": "qia20",
              "default": 1,
              "wenhao": "刚好打20点算1敲"
            },
            {
              "name": "暗四对2敲",
              "value": "anDui",
              "default": 0,
              "wenhao": "每个龙加2敲"
            },
            {
              "name": "杠上花1敲",
              "value": "gangHua",
              "default": 1
            },
            {
              "name": "杠上炮1敲",
              "value": "gangPao",
              "default": 0
            },
            {
              "name": "四归一2敲",
              "value": "siGuiYi",
              "default": 1,
              "wenhao": "手下3张，手上与一张，这4张算2敲"
            }
          ]
        },
        "config_location": {
          "name": "定位:",
          "multiple": 1,
          "maxCell": 3,
          "config": [
            {
              "name": "开启GPS定位",
              "value": "openGps",
              "default": 0
            }
          ]
        }
      }
    }
  ],
  "27": [
    {
      "name": "筠连斗十四",
      "gameId": 27,
      "rule": {
        "config_pay": {
          "name": "房费:",
          "multiple": 0,
          "maxCell": 3,
          "param": "useCardType",
          "config": [
            {
              "name": "AA",
              "value": 2,
              "default": 1,
              "wenhao": "所有人均摊"
            },
            {
              "name": "房主",
              "value": 1,
              "default": 0,
              "wenhao": "由创建房间玩家一人承担"
            }
          ]
        },
        "config_count": {
          "name": "局数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "gameNum",
          "config": [
            {
              "name": "4局",
              "value": 4,
              "default": 1
            },
            {
              "name": "8局",
              "value": 8,
              "default": 0
            },
            {
              "name": "12局",
              "value": 12,
              "default": 0
            }
          ]
        },
        "config_players": {
          "name": "人数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "playerNum",
          "config": [
            {
              "name": "2人",
              "value": 2,
              "default": 0
            },
            {
              "name": "3人",
              "value": 3,
              "default": 0
            },
            {
              "name": "4人",
              "value": 4,
              "default": 1
            }
          ]
        },
        "config_wang": {
          "name": "听用:",
          "multiple": 0,
          "maxCell": 3,
          "param": "wangNum",
          "config": [
            {
              "name": "0",
              "value": 0,
              "default": 1,
              "wenhao": "不打"
            },
            {
              "name": "1",
              "value": 1,
              "default": 0,
              "wenhao": "白皮当听用"
            }
          ]
        },
        "config_qihu": {
          "name": "起胡:",
          "multiple": 0,
          "maxCell": 3,
          "param": "huRedScore",
          "config": [
            {
              "name": "红21点",
              "value": 21,
              "default": 1
            },
            {
              "name": "红25点",
              "value": 25,
              "default": 0
            }
          ]
        },
        "config_qifan": {
          "name": "起番:",
          "multiple": 0,
          "maxCell": 3,
          "param": "qiFanDianNum",
          "config": [
            {
              "name": "21点算1番",
              "value": 21,
              "default": 1
            },
            {
              "name": "25点算1番",
              "value": 25,
              "default": 0
            }
          ]
        },
        "config_duizi": {
          "name": "对子:",
          "multiple": 0,
          "maxCell": 3,
          "param": "anDuiFanNum",
          "config": [
            {
              "name": "明8暗6鸳10",
              "value": 6,
              "default": 1
            },
            {
              "name": "明15暗10鸳14",
              "value": 10,
              "default": 0
            }
          ]
        },
        "config_playmethod": {
          "name": "玩法:",
          "multiple": 1,
          "maxCell": 3,
          "offset": 300,
          "config": [
            {
              "name": "巧20算4番",
              "value": "qia20",
              "default": 1
            },
            {
              "name": "门清",
              "value": "menQing",
              "default": 1
            },
            {
              "name": "抢胡",
              "value": "daShaQiangHu",
              "default": 1
            },
            {
              "name": "抢7胡",
              "value": "qiang_7Hu",
              "default": 1
            },
            {
              "name": "海底捞",
              "value": "haiDiLao",
              "default": 1
            },
            {
              "name": "自抢胡",
              "value": "ziQiangHu",
              "default": 1
            },
            {
              "name": "7红7黑",
              "value": "da_7hong_7hei",
              "default": 0
            },
            {
              "name": "一点朱",
              "value": "yiDianZhu",
              "default": 0
            },
            {
              "name": "全求人",
              "value": "quanQiuRen",
              "default": 0
            },
            {
              "name": "乱胡",
              "value": "luanHu",
              "default": 0
            },
            {
              "name": "小胡",
              "value": "xiaoHu",
              "default": 0
            },
            {
              "name": "四张落地",
              "value": "siZhangLuoDi",
              "default": 0
            }
          ]
        },
        "config_location": {
          "name": "定位:",
          "multiple": 1,
          "maxCell": 3,
          "config": [
            {
              "name": "开启GPS定位",
              "value": "openGps",
              "default": 0
            }
          ]
        }
      }
    }
  ],
  "101": [
    {
      "name": "红二十血战",
      "gameId": 101,
      "rule": {
        "config_pay": {
          "name": "房费:",
          "multiple": 0,
          "maxCell": 3,
          "param": "useCardType",
          "config": [
            {
              "name": "AA",
              "value": 2,
              "default": 1,
              "wenhao": "所有人均摊"
            },
            {
              "name": "房主",
              "value": 1,
              "default": 0,
              "wenhao": "由创建房间玩家一人承担"
            }
          ]
        },
        "config_count": {
          "name": "局数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "gameNum",
          "config": [
            {
              "name": "4局",
              "value": 4,
              "default": 1
            },
            {
              "name": "8局",
              "value": 8,
              "default": 0
            },
            {
              "name": "12局",
              "value": 12,
              "default": 0
            }
          ]
        },
        "config_players": {
          "name": "人数:",
          "multiple": 0,
          "maxCell": 3,
          "param": "playerNum",
          "config": [
            {
              "name": "2人",
              "value": 2,
              "default": 0
            },
            {
              "name": "3人",
              "value": 3,
              "default": 1
            },
            {
              "name": "4人",
              "value": 4,
              "default": 0
            }
          ]
        },
        "config_eat": {
          "name": "吃牌:",
          "multiple": 0,
          "maxCell": 3,
          "param": "ziChi",
          "config": [
            {
              "name": "自摸自吃",
              "value": 1,
              "default": 1
            },
            {
              "name": "可吃上家",
              "value": 0,
              "default": 0
            }
          ]
        },
        "config_wang": {
          "name": "王数:",
          "multiple": 0,
          "maxCell": 4,
          "param": "wangNum",
          "config": [
            {
              "name": "3",
              "value": 3,
              "default": 0,
              "wenhao": "1小王、1大王、1白板"
            },
            {
              "name": "6",
              "value": 6,
              "default": 1,
              "wenhao": "2小王、2大王、2白板"
            },
            {
              "name": "9",
              "value": 9,
              "default": 0,
              "wenhao": "3小王、3大王、3白板"
            },
            {
              "name": "12",
              "value": 12,
              "default": 0,
              "wenhao": "4小王、4大王、4白板"
            }
          ]
        },
        "config_qi_wang": {
          "name": "7当王:",
          "multiple": 0,
          "maxCell": 4,
          "param": "qiWangNum",
          "config": [
            {
              "name": "0",
              "value": 0,
              "default": 0,
              "wenhao": "1副牌的4个7不当王，按正常牌用"
            },
            {
              "name": "4",
              "value": 4,
              "default": 0,
              "wenhao": "1副牌的4个7当王"
            },
            {
              "name": "6",
              "value": 6,
              "default": 0,
              "wenhao": "1副牌的4个7再加上一个红7和一个黑7当王"
            },
            {
              "name": "8",
              "value": 8,
              "default": 1,
              "wenhao": "2副牌的7当王"
            },
            {
              "name": "12",
              "value": 12,
              "default": 0,
              "wenhao": "3副牌的7当王"
            }
          ]
        },
        "config_fan": {
          "name": "算分:",
          "maxCell": 3,
          "offset": 350,
          "multiple": 0,
          "param": "chengFan",
          "config": [
            {
              "name": "滚滚翻(翻相乘)",
              "value": 1,
              "default": 0,
              "wenhao": "1*2(各番数之和)，如4番就是16分"
            },
            {
              "name": "梯坎翻(翻相加)",
              "value": 0,
              "default": 1,
              "wenhao": "1+所有番数，如4番算5分"
            }
          ]
        },
        "config_playmethod": {
          "name": "玩法:",
          "multiple": 1,
          "maxCell": 3,
          "config": [
            {
              "name": "红50和黑50",
              "value": "hongHei_50",
              "default": 1
            },
            {
              "name": "报叫三番",
              "value": "baoJiao",
              "default": 1
            },
            {
              "name": "金二十一番",
              "value": "qia20",
              "default": 1,
              "wenhao": "刚好红20点算1番"
            },
            {
              "name": "杠上花",
              "value": "gangHua",
              "default": 1
            },
            {
              "name": "杠上炮",
              "value": "gangPao",
              "default": 1
            },
            {
              "name": "黄庄查叫",
              "value": "chaJiao",
              "default": 1
            },
            {
              "name": "金钩钓",
              "value": "jinGouDiao",
              "default": 0,
              "wenhao": "碰光，手里只留一张牌"
            },
            {
              "name": "暗四对三番",
              "value": "anDui",
              "default": 0,
              "wenhao": "每个龙加3番"
            }
          ]
        },
        "config_location": {
          "name": "定位:",
          "multiple": 1,
          "maxCell": 3,
          "config": [
            {
              "name": "开启GPS定位",
              "value": "openGps",
              "default": 0
            }
          ]
        }
      }
    }
  ]
};
