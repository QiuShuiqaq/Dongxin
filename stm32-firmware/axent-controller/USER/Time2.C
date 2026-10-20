#include "stm32f10x.h"
#include "Hal.H"
#include "STEPPER.H"

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


uint8_t  Beep_Count = 0;								// 鸣叫次数 
uint16_t Beep_Tmr;										// 鸣叫时长 短叫，持续时间 100ms 长叫，持续时间 500ms
uint16_t Beep_Interval;									// 鸣叫间隔 时长 200mS
uint16_t beep_tmr0;										// 运行内存        
uint16_t beep_interval0;								// 运行内存        
uint8_t Time_1ms_flag = 0;

extern uint8_t Step_Moto_flag;							//步进电机标志位							 
extern uint8_t delay_1_Minute;							//上电 1分钟配网延时
extern uint8_t Warm_Delay_15S;							//取暖延时			   
extern uint8_t Tmr_1Min;								//1分钟 寄存器		
extern uint8_t CuShi_TMR_Flag;							//除湿定时时标			   			   
extern volatile uint8_t Work_TMR_Flag;							//工作（1分钟标志）			   			   
extern uint8_t CuShi_TMR;								//除湿时间t1 t2
extern uint8_t CuShi_Count;								//除湿循环次数			   

extern uint8_t sub_delay30S;							//吹风关闭后延时(散热)	   

extern uint8_t WenDu_Flag;		
uint8_t Net_Pop_Flag = 0;								//配网闪烁 标志位	
uint8_t Net_delay = 0;									//配网1分种计时

volatile uint16_t adc_tmr = 0;	
extern uint8_t Rst_Net;				//重置 WIFI， 进入配网模式 0x0A
volatile uint8_t Net_Send_F = 1;										//发送查询时间标志位	
volatile uint8_t Seek_2_tmr_F = 0;
/*******************************************************************************************************
                                        配置定时器计数值
 可以每 100us 产生一次中断。
*******************************************************************************************************/   
void Tim2_Init(void)
{
    TIM_TimeBaseInitTypeDef TIM_StructInit;
    NVIC_InitTypeDef NVIC_StructInit;

    RCC_APB1PeriphClockCmd(RCC_APB1Periph_TIM2, ENABLE);					// 定时器 TIM2 时钟使能

    TIM_StructInit.TIM_Period   			= 80-1;							// 自动装载值
    TIM_StructInit.TIM_Prescaler			= SystemCoreClock/7200000-1;	// 预分频系数
    TIM_StructInit.TIM_ClockDivision		= TIM_CKD_DIV1;					// 定时器时钟分频因子
    TIM_StructInit.TIM_CounterMode			= TIM_CounterMode_Up;			// 向上计数
    TIM_StructInit.TIM_RepetitionCounter	= 0;							// 
    TIM_TimeBaseInit(TIM2, &TIM_StructInit);								// 初始化 TIM2

    TIM_ITConfig(TIM2, TIM_IT_Update, ENABLE);								// 定时器 TIM2 中断使能
    TIM_Cmd(TIM2, ENABLE);													// 定时器 TIM2 使能
    TIM_ClearFlag(TIM2, TIM_FLAG_Update);									// 清除 中断标志位

    NVIC_StructInit.NVIC_IRQChannel		= TIM2_IRQn;
    NVIC_StructInit.NVIC_IRQChannelCmd	= ENABLE;
    NVIC_StructInit.NVIC_IRQChannelPreemptionPriority = 1;					// 抢占优先级 1
    NVIC_StructInit.NVIC_IRQChannelSubPriority        = 1;					// 
    NVIC_Init(&NVIC_StructInit);
}

/*******************************************************************************************************
                                         TIM2 中断函数 100uS
*******************************************************************************************************/ 
void TIM2_IRQHandler(void)
{
 static uint16_t tt0;
 static uint16_t Step_Moto_Tmr;	
 static uint16_t Tmr_1Sec;

 TIM_ClearITPendingBit(TIM2, TIM_IT_Update);				// 清除中断标志
 if (GPIO_ReadInputDataBit(GPIOB, GPIO_Pin_15) == 0)	
	{Test_Pin_High;
    }
 else
   {Test_Pin_Low;
   }

/*----------------------------------------------------------------------------------------------------*/ 
 if (++Step_Moto_Tmr >= MOTO_TMR)							//步进电机间隔					
    {Step_Moto_Tmr = 0;
	 Step_Moto_flag = 1;									// 步进电机标志位
	}	 
/*----------------------------------------------------------------------------------------------------*/ 
 if (++adc_tmr >= 4975)										//ADC取样间隔 = 500mS
	{adc_tmr = 0;
	 WenDu_Flag = 1;
	 Net_Pop_Flag = ~Net_Pop_Flag;							//配网闪烁 标志位	
	 Net_Send_F = 1;										//发送查询时间标志位	
	 Seek_2_tmr_F = 1;	
     if (Net_delay != 0)	 								//1分钟配网延时 --
	    {Net_delay--;}
	 else
	    {Rst_Net = 0x00;									//重置配网 值 0x00
		}		 
	}

/*----------------------------------------------------------------------------------------------------*/ 
//                               【1秒钟】
/*----------------------------------------------------------------------------------------------------*/ 
 if (++Tmr_1Sec >= 10000)						
    {Tmr_1Sec = 0;
     
/*----------------------------------------------------------------------------------------------------*/ 
     if (delay_1_Minute != 0)						//上电 1分钟配网延时
        {delay_1_Minute--;}		
/*----------------------------------------------------------------------------------------------------*/ 
	 if (sub_delay30S != 0) {sub_delay30S--;}	//吹风关闭后延时(散热)		 
			
	 if (Stat.Sub_CuiFen == 1)					//####[辅助吹风 = 1]####
		{
		 if (Warm_Delay_15S != 0)				//延时15秒 <> 0	
			{Warm_Delay_15S--;					//15秒--
			}
		 else									//延时15秒 == 0	
			{Stat.Sub_CuiFen = 0;				//辅助吹风 = 0
             Stat.CuiFen = 0;					//关闭吹风
			 if (Stat.CuShi == 0)				//除湿 = 0
				{
				 dj_d_status = 0;				//-[关闭摆页]-
				 dj_sw_en = 1;  				//摆叶切换状态使能 = 1  															
				}
			}							 
		}		
/*----------------------------------------------------------------------------------------------------*/ 			
	 if (++Tmr_1Min >= 60)						//【1分钟】	
		{Tmr_1Min  = 0;
		 CuShi_TMR_Flag = 1;					//除湿定时时标 = 1
		 Work_TMR_Flag = 1;						//工作（1分钟标志）
		}			
	}
	
/*----------------------------------------------------------------------------------------------------*/
//                                              蜂鸣器
/*----------------------------------------------------------------------------------------------------*/   
 if (++tt0 > 10)
    {tt0 = 0;
	 Time_1ms_flag = 1;										// 1mS 标志

     if (Beep_Count != 0)									// 判断蜂鸣器 鸣叫次数
	    {
		 if (beep_tmr0 != 0)								// 鸣叫长度 <> 0
		    {beep_tmr0--;
		     TIM_SetCompare4(TIM4,50);						// PWM 输出
			}
		 else												// 鸣叫长度 == 0
		    {TIM_SetCompare4(TIM4,00);						// PWM 关闭
 			 if (beep_interval0 != 0)						// 间隔 <> 0
			    {beep_interval0--;
				}
             else											// 间隔 == 0
			    {Beep_Count--;								// 次数减 1
				 beep_tmr0 = Beep_Tmr;						// 时长重载
				 beep_interval0 = Beep_Interval;			// 间隔重载
				}				 
			}			 
		}
	}	 
}

/*******************************************************************************************************
                          	                 蜂鸣器Beeping
 描述：count 鸣叫次数     tmr 鸣叫时长      interval 鸣叫间隔时间
*******************************************************************************************************/   
void Beeping(uint8_t _cout,uint16_t _tmr,uint16_t _interval)
{
 if (Beep_Count == 0)	
    {
	 Beep_Count     = _cout;							//鸣叫次数 
     Beep_Tmr       = _tmr;								//鸣叫时长
	 Beep_Interval  = _interval;						//鸣叫间隔	
		
	 beep_tmr0      = Beep_Tmr;							//装入 运行内存 时长
	 beep_interval0 = Beep_Interval;					//装入 运行内存 间隔
	}
}

/*---------------------------------------------------------------------------*/
//                             除湿运行时间
/*---------------------------------------------------------------------------*/
void CuShi_TMR_Pro(void)
{
 if (CuShi_TMR_Flag == 1)							//除湿定时时标
    {CuShi_TMR_Flag = 0;						
	 if (Stat.CuShi == 1)							//除湿 == 1
		{
		 if (CuShi_TMR != 0)	
			{CuShi_TMR--;}							//除湿时间t1 t2	
		 else
			{if (CuShi_Count != 0)					//除湿循环次数
				{
				 if ((CuShi_Count==2)||(CuShi_Count==4)||(CuShi_Count==6)||(CuShi_Count==8)||(CuShi_Count==10)||(CuShi_Count==12)||(CuShi_Count==14)||(CuShi_Count==16) )	//【偶数】
					{CuShi_TMR = CuShi_Hot;			//除湿 热 10 分钟
					 Stat.HuanQi = 0;				//换气 = 0
					 Stat.CuiFen = 1;				//吹风 = 1		
					 Stat.S_Warm = 1;				//强暖 = 1
					 Stat.W_Warm = 1;				//弱暖 = 1								
					 //dj_d_status = 2;				//【自动摆叶】	
					 //dj_sw_en = 1;  				//摆叶切换状态使能 = 1	
					}
				 if ((CuShi_Count==1)||(CuShi_Count==3)||(CuShi_Count==5)||(CuShi_Count==7)||(CuShi_Count==9)||(CuShi_Count==11)||(CuShi_Count==13)||(CuShi_Count==15) )	//【奇数】
					{CuShi_TMR = CuShi_Cold;		//除湿 冷 5 分钟
					 Stat.CuiFen = 1;				//打开吹风 									 
					 Stat.Sub_CuiFen = 1;			//辅助吹风=1 
					 Warm_Delay_15S = W_delay_Tmr;	//取暖延时=15  					 								
					 Stat.HuanQi = 1;				//换气 = 1
					 Stat.S_Warm = 0;				//强暖 = 0
					 Stat.W_Warm = 0;				//弱暖 = 0								
					}
				 CuShi_Count--;	
				}
			 else									//CuShi_TMR==0 / CuShi_Count==0
				{CuShi_Count = 0;					//除湿循环次数 = 0 （结束）
				 CuShi_TMR   = 0;					//除湿时间t1 t2		
				 Stat.CuShi  = 0;					//除湿 = 0	
				 Stat.S_Warm = 0;					//强暖 = 0
				 Stat.W_Warm = 0;					//弱暖 = 0
				 Stat.CuiFen = 0;					//吹风 = 0
				 Stat.HuanQi = 0;					//换气 = 0	
				 dj_d_status = 0;					//-[关闭摆页]-
				 dj_sw_en = 1;  					//摆叶切换状态使能 = 1  																
				}					 
			}				 
		}	
	} 
}	

/*---------------------------------------------------------------------------*/



