#include "stm32f10x.h"
#include "Hal.H"
#include "STEPPER.H"

/******************************************************************************************************/
typedef struct {
				unsigned int ZaoMin    		:1;		//照明
				unsigned int HuanQi  		:1;		//换气
				unsigned int CuiFen  		:1;		//吹风
	            unsigned int W_Warm	        :1;		//弱暖
	            unsigned int S_Warm	        :1;		//强暖
				unsigned int BaiYei  		:2;		//摆叶 0关闭 1打开 2停止 3自动
				unsigned int CuShi			:1;		//除湿
				unsigned int Power1 	  	:1;		//待机	
	  			unsigned int Sub_CuiFen  	:1;		//辅助吹风
               }str0;
extern str0 Stat;

/*******************************************************************************************************
                                                GPIO初始化
*******************************************************************************************************/   
void GPIO_Init0(void) 
{
 GPIO_InitTypeDef gpio_initstruct;									// IO 配置结构体

 RCC_APB2PeriphClockCmd(RCC_APB2Periph_GPIOA,  ENABLE);				// 启用 GPIOA  的时钟	
 RCC_APB2PeriphClockCmd(RCC_APB2Periph_GPIOB,  ENABLE);				// 启用 GPIOB  的时钟	
 RCC_APB2PeriphClockCmd(RCC_APB2Periph_AFIO, ENABLE);  				// 使能 AFIO   时钟	
	
 gpio_initstruct.GPIO_Pin 		= (GPIO_Pin_0 | GPIO_Pin_1 | GPIO_Pin_2 | GPIO_Pin_3 | GPIO_Pin_4 | GPIO_Pin_5 | GPIO_Pin_6 | GPIO_Pin_7 | GPIO_Pin_8 | GPIO_Pin_9 | GPIO_Pin_12 |GPIO_Pin_15); 		
 gpio_initstruct.GPIO_Mode 		= GPIO_Mode_Out_PP; 				// 推挽输出
 gpio_initstruct.GPIO_Speed 	= GPIO_Speed_50MHz;
 GPIO_Init(GPIOB, &gpio_initstruct);								//  初始化 GPIOB
	
 GPIO_ResetBits(GPIOB, GPIO_Pin_0 | GPIO_Pin_1 | GPIO_Pin_2 | GPIO_Pin_3 | GPIO_Pin_4 | GPIO_Pin_5 | GPIO_Pin_6 | GPIO_Pin_7 | GPIO_Pin_8 | GPIO_Pin_9 |  GPIO_Pin_12 |GPIO_Pin_15); 	// 默认关闭 

																	// [PA8][PA11][PA12] --> TM1620
 gpio_initstruct.GPIO_Pin 		= (GPIO_Pin_8 | GPIO_Pin_11 | GPIO_Pin_12); 		
 gpio_initstruct.GPIO_Mode 		= GPIO_Mode_Out_PP; 				// 推挽输出
 gpio_initstruct.GPIO_Speed 	= GPIO_Speed_50MHz;
 GPIO_Init(GPIOA, &gpio_initstruct);								// 初始化 GPIOA
 GPIO_PinRemapConfig(GPIO_Remap_SWJ_JTAGDisable, ENABLE);			// 使用 PB3 PB4 SW调试，停止JATG	
//PB3,PB4,PA15	
}

/******************************************************************************************************/
void init_Status(void)			//系统参数初始化	
{
 Stat.ZaoMin = 0;				//关照明
 Stat.HuanQi = 0;				//关换气
 Stat.CuiFen = 0;				//关吹风
 Stat.W_Warm = 0;				//关弱暖	
 Stat.S_Warm = 0;				//关强暖		
 Stat.BaiYei = 0;				//关摆叶
 Stat.CuShi  = 0;				//关除湿
 Stat.Power1 = 0;				//关机	
 Stat.Sub_CuiFen = 0;			//辅助吹风=0	
}	

/*******************************************************************************************************
	                                         系统端口 处理
*******************************************************************************************************/
void Sys_Running(void)
{
 if (Stat.ZaoMin == 1)									//照明
    {ZaoMin_High;}	
 else
    {ZaoMin_Low;}	 
/*---------------------------------------------------------------------------------------------------*/
 if (Stat.HuanQi == 1)									//换气
    {HuanQi_High;}
 else
    {HuanQi_Low;}
/*---------------------------------------------------------------------------------------------------*/
 if (Stat.Sub_CuiFen == 0)								//辅助吹风==0
    {
	 if (Stat.CuiFen == 1)								//吹风
        {CuiFen_High;}
     else
        {CuiFen_Low;}				
	}
 else													//辅助吹风==1
    {CuiFen_High;
	}	 
/*---------------------------------------------------------------------------------------------------*/
 if (Stat.S_Warm == 1)									//强暖
    {S_Warm_High;
	 CuiFen_High;				//风扇打开 【保护不空烧电热丝】
	}
 else
    {S_Warm_Low;}	 
/*---------------------------------------------------------------------------------------------------*/
 if (Stat.W_Warm == 1)									//弱暖
    {W_Warm_High;
	 CuiFen_High;				//风扇打开 【保护不空烧电热丝】
	}
 else
    {W_Warm_Low;}	 		
}


