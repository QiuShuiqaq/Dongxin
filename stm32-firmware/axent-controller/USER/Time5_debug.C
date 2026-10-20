#include "stm32f10x.h"
#include "Hal.H"
#include "STEPPER.H"


/*******************************************************************************************************
                                        配置定时器计数值
 可以每 100us 产生一次中断。
*******************************************************************************************************/   
void Tim5_Init(void)
{
    TIM_TimeBaseInitTypeDef TIM_StructInit;
    NVIC_InitTypeDef NVIC_StructInit;

    RCC_APB1PeriphClockCmd(RCC_APB1Periph_TIM5, ENABLE);					// 定时器 TIM5 时钟使能

    TIM_StructInit.TIM_Period   			= 80-1;							// 自动装载值
    TIM_StructInit.TIM_Prescaler			= SystemCoreClock/7200000-1;	// 预分频系数
    TIM_StructInit.TIM_ClockDivision		= TIM_CKD_DIV1;					// 定时器时钟分频因子
    TIM_StructInit.TIM_CounterMode			= TIM_CounterMode_Up;			// 向上计数
    TIM_StructInit.TIM_RepetitionCounter	= 0;							// 
    TIM_TimeBaseInit(TIM5, &TIM_StructInit);								// 初始化 TIM5

    TIM_ITConfig(TIM5, TIM_IT_Update, ENABLE);								// 定时器 TIM5 中断使能
    TIM_Cmd(TIM5, ENABLE);													// 定时器 TIM5 使能
    TIM_ClearFlag(TIM5, TIM_FLAG_Update);									// 清除 中断标志位

    NVIC_StructInit.NVIC_IRQChannel		= TIM3_IRQn;
    NVIC_StructInit.NVIC_IRQChannelCmd	= ENABLE;
    NVIC_StructInit.NVIC_IRQChannelPreemptionPriority = 1;					// 抢占优先级 1
    NVIC_StructInit.NVIC_IRQChannelSubPriority        = 1;					// 
    NVIC_Init(&NVIC_StructInit);
}





