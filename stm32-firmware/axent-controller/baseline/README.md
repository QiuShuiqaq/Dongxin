# STM32 固件基线

以下文件从东信提供的原始工程复制，用于追溯和回滚。除历史构建日志明确记录的编译结果外，文件名不能证明其对应的具体硬件版本。HEX 和原始构建日志只保存在本机，因其属于生成物且日志含旧环境信息，已通过 `.gitignore` 排除；Git 仓库保留本说明中的校验值和构建结论。

| 文件 | SHA-256 | 状态 |
| --- | --- | --- |
| `AXENT(5).hex` | `849959E7DEEB4B357D5201785D52BFAA6FA28DEBE866D27F3A5918F1E1B539F8` | 原始资料，未在当前样机核对 |
| `AXENT(6).hex` | `C326690AD9E041AE15645EB86AF999DDB603D9421F86EA92DFA8C022A57E3BAC` | 原始资料，未在当前样机核对 |
| `AXENT-build-20260424.hex` | `169CD4A38ABAED897133CE77CAE4FF30F3096CD7D6A357C429BDD61C293B5AD3` | 原工程 `Objects` 中的构建产物 |
| `AXENT-AC6-migration-baseline-unverified.hex` | `72F093ABDC70AB844BDDC108EB02CAD5D72F786FCCEFC97C59B048368C5CCD7A` | AC6 迁移基线，未烧录、未做硬件验证 |

历史日志 `AXENT-build-20260424.log.html` 记录 ARMCC 5.06u7 构建结果为 `0 Error(s), 0 Warning(s)`，程序尺寸为 `Code=14568, RO-data=468, RW-data=160, ZI-data=2192`。

AC6 迁移基线日志 `AXENT-AC6-migration-baseline-unverified.log.html` 记录 ARM Compiler 6.24 构建结果为 `0 Error(s), 0 Warning(s)`，程序尺寸为 `Code=15834, RO-data=486, RW-data=20, ZI-data=2308`。

任何 HEX 写入样机前都必须先确认目标芯片、硬件版本和回滚文件，不允许根据文件名直接判断量产版本。
