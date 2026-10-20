#include "stm32f10x.h"
#include "Hal.H"
#include "STEPPER.H"

/*******************************************************************************************************
                                     配置定时器4 通道1 (PB9) PWM输出配置

*******************************************************************************************************/   
void TIM4_PWM_Init (void)
{
/*----------------------------------------------------------------------------------------------------*/	
 RCC_APB2PeriphClockCmd(RCC_APB2Periph_GPIOB,  ENABLE);				// 启用 GPIOB  的时钟

 GPIO_InitTypeDef gpio_initstruct;									// IO 配置结构体
 gpio_initstruct.GPIO_Pin = GPIO_Pin_9;
 gpio_initstruct.GPIO_Speed = GPIO_Speed_50MHz;
 gpio_initstruct.GPIO_Mode = GPIO_Mode_AF_PP;						// 配置 PB9 为复用推挽输出
 GPIO_Init(GPIOB, &gpio_initstruct);

/*----------------------------------------------------------------------------------------------------*/
//                                           初始化定时器 4
/*----------------------------------------------------------------------------------------------------*/
 RCC_APB1PeriphClockCmd (RCC_APB1Periph_TIM4, ENABLE); 					// 使能 TIM4 时钟

 TIM_TimeBaseInitTypeDef TIM_TimeBaseStructure;							//
 TIM_TimeBaseStructure.TIM_Period 		 = 600-1; 						// 设设计数器自动重装值
 TIM_TimeBaseStructure.TIM_Prescaler 	 = SystemCoreClock/7200000-1;	// 预分频系数
 TIM_TimeBaseStructure.TIM_ClockDivision = TIM_CKD_DIV1; 				// 设置时钟分割：TDTS = Tck_tim
 TIM_TimeBaseStructure.TIM_CounterMode 	 = TIM_CounterMode_Up; 			// TIM 向上计数模式
 TIM_TimeBaseStructure.TIM_RepetitionCounter	= 0;					// 	
 TIM_TimeBaseInit (TIM4, &TIM_TimeBaseStructure); 						// 

/*----------------------------------------------------------------------------------------------------*/
//                                        初始化 PWM 参数
/*----------------------------------------------------------------------------------------------------*/
 TIM_OCInitTypeDef TIM_OCInitTypeStrue;									//
 
 TIM_OCInitTypeStrue.TIM_OCMode			= TIM_OCMode_PWM2;				// PWM2 模式
 TIM_OCInitTypeStrue.TIM_OCPolarity		= TIM_OCPolarity_Low;			// 极性 高
 TIM_OCInitTypeStrue.TIM_OutputState	= TIM_OutputState_Enable;		// 输出 允许	
 TIM_OC4Init(TIM4,&TIM_OCInitTypeStrue);								// TIM4 通道4
 
 TIM_OC4PreloadConfig(TIM4,TIM_OCPreload_Enable);						// 使能 通道4 预装载
 TIM_Cmd(TIM4, ENABLE);													// 使能 TIM4	
}


