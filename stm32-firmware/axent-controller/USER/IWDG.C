#include "stm32f10x.h"
#include "Hal.H"
#include "STEPPER.H"

/*******************************************************************************************************
                                             看门狗初始化
*******************************************************************************************************/   
void IWDG_Init(void)
{
 IWDG_WriteAccessCmd(IWDG_WriteAccess_Enable);		// 取消写保护 0x5555 使能
 IWDG_SetPrescaler(4);								// 设置预分频系数 写 PR  (4 = 1/64)
 IWDG_SetReload(200);								// 设置重装载值 写 RLR
 IWDG_ReloadCounter();								// 喂狗 写 0xAAAA -> KR
 IWDG_Enable();										// 使能看门狗 写 0xCCCC -> KR	
}
