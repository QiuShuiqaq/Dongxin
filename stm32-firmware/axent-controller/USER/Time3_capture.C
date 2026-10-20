#include "stm32f10x.h"
#include "Hal.H"
#include "STEPPER.H"


#include <stdio.h>

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

uint16_t TW_reg[128];
uint8_t syc_check_flag = 0;							//捕捉到下降沿标志
uint8_t rec_check_flag = 0;							//数据开始接收标志	
uint8_t iii = 0;									//接收计数
			   
uint8_t err_flag = 0;			   
uint8_t eprom_f = 0;			   
			   
uint8_t power_num0 = 0;								//上电待机键计数值
extern uint16_t write_data[4];  					// 待写入数据			   
extern uint16_t read_data[4];  						// 读取缓冲区
extern uint16_t adc_tmr;				   

extern uint8_t cuifen0;				//【吹风状态】 防重入
extern uint8_t warm0;	
extern uint8_t cushi0;

extern uint8_t Net_delay;			//配网1分种计时			
extern uint8_t Rst_Net;				//重置 WIFI， 进入配网模式 0x0A
extern uint8_t delay_1_Minute;		//上电 1分钟配网延时
extern uint8_t Ble_Stat;				//BLE状态位			   
extern uint8_t Net_Suess_F;			//鸿蒙配网成功标志
extern uint8_t send_Net_Setup_flag;			//发送重置配网标志
extern uint8_t Status1;			   
extern uint8_t En_Net_Flag;			//联网使能

extern uint8_t Warm_Delay_15S;				//取暖延时			   

extern void Uart_Tx(unsigned char uart,unsigned char com0,unsigned char sw0,unsigned char stat0,unsigned char stat1);
/*----------------------------------------------------------------------------------------------------*/
enum
{
	Key_BaiYi_ON 		= 0x01,				//[摆风键]-开
	Key_BaiYi_OFF		= 0x02,				//[摆风键]-关
	
	Key_CuiFen_ON		=0x03,				//[吹风键]-开
	Key_CuiFen_OFF		=0x04,				//[吹风键]-关
	
	Key_ZaoMin_ON		=0x05,				//[照明键]-开	
	Key_ZaoMin_OFF		=0x06,				//[照明键]-关	
	
	Key_S_Warm_ON		=0x07,    			//[强暖键]-开
	Key_S_Warm_OFF		=0x08,    			//[强暖键]-关	
	
	Key_W_Warm_ON		=0x09,				//[弱暖键]-开
	Key_W_Warm_OFF		=0x0A,				//[弱暖键]-关
	
	Key_CuShi_ON		=0x0B,				//[除湿键]-开
	Key_CuShi_OFF		=0x0C,				//[除湿键]-关	

	Key_HuanQi_ON		=0x0D,				//[换气键]-开
	Key_HuanQi_OFF		=0x0E,				//[换气键]-关
	
	Key_Power			=0x0F,				//[待机键]
	Key_Rst_WiFi		=0x10,				//[重置配网]
	Key_WiFi_En         =0x11,				//[联网使能]		
	
};			   
			   
/*******************************************************************************************************
                                     配置定时器3 通道1 (PA6) 输入捕获配置

*******************************************************************************************************/   
void TIM3_Cap_Init (void)
{
/*----------------------------------------------------------------------------------------------------*/
RCC_APB2PeriphClockCmd (RCC_APB2Periph_GPIOA, ENABLE); 				// 使能 GPIOA 时钟	

GPIO_InitTypeDef GPIO_InitStructure;								//
GPIO_InitStructure.GPIO_Pin  = GPIO_Pin_6; 							//PA6 清除之前设置
GPIO_InitStructure.GPIO_Mode = GPIO_Mode_IPD; 						//PA6 输入
GPIO_Init (GPIOA, &GPIO_InitStructure);								//
GPIO_ResetBits (GPIOA,GPIO_Pin_6); 									//PA6 下拉
	
/*----------------------------------------------------------------------------------------------------*/
//                                           初始化定时器 3
/*----------------------------------------------------------------------------------------------------*/
RCC_APB1PeriphClockCmd (RCC_APB1Periph_TIM3, ENABLE); 				// 使能 TIM3 时钟

TIM_TimeBaseInitTypeDef TIM_TimeBaseStructure;						//
TIM_TimeBaseStructure.TIM_Period 		= 0xffff; 					// 设设计数器自动重装值
TIM_TimeBaseStructure.TIM_Prescaler 	= SystemCoreClock/7200000-1;// 预分频系数
TIM_TimeBaseStructure.TIM_ClockDivision = TIM_CKD_DIV1; 			// 设置时钟分割：TDTS = Tck_tim
TIM_TimeBaseStructure.TIM_CounterMode 	= TIM_CounterMode_Up; 		// TIM 向上计数模式
TIM_TimeBaseInit (TIM3, &TIM_TimeBaseStructure); 					// 

/*----------------------------------------------------------------------------------------------------*/
//                                     初始化TIM3 输入捕获参数
/*----------------------------------------------------------------------------------------------------*/
 TIM_ICInitTypeDef TIM3_ICInitStructure;							//								
	
 TIM3_ICInitStructure.TIM_Channel 		=  TIM_Channel_1; 			// CC1S=01 选择输入端 IC1 映射到 TI1 上
 TIM3_ICInitStructure.TIM_ICPolarity 	=  TIM_ICPolarity_Rising; 	// 上升沿捕获
 TIM3_ICInitStructure.TIM_ICSelection 	=  TIM_ICSelection_DirectTI;// 映射到 TI1 上
 TIM3_ICInitStructure.TIM_ICPrescaler 	=  TIM_ICPSC_DIV1; 			// 配置输入分频，不分频
 TIM3_ICInitStructure.TIM_ICFilter 		=  0x00;					// IC1F=0000 配置输入滤波器 不滤波
 TIM_ICInit (TIM3, &TIM3_ICInitStructure);							//
	
/*----------------------------------------------------------------------------------------------------*/
//                                             中断分组初始化
/*----------------------------------------------------------------------------------------------------*/
 NVIC_InitTypeDef NVIC_InitStructure;								//			

 NVIC_InitStructure.NVIC_IRQChannel 				  = TIM3_IRQn; 	// TIM3 中断
 NVIC_InitStructure.NVIC_IRQChannelPreemptionPriority = 2; 			// 先占优先级 2 级
 NVIC_InitStructure.NVIC_IRQChannelSubPriority 		  = 2; 			// 从优先级 0 级
 NVIC_InitStructure.NVIC_IRQChannelCmd 				  = ENABLE; 	// IRQ 通道被使能
 NVIC_Init (&NVIC_InitStructure); 									// 

/*----------------------------------------------------------------------------------------------------*/
 TIM_ITConfig (TIM3,TIM_IT_Update|TIM_IT_CC1,ENABLE);				// 允许更新中断，允许 CC1IE 捕获中断
 TIM_Cmd (TIM3,ENABLE);	 											// 使能定时器 3
}

/*******************************************************************************************************
                                         TIM3 中断函数
*******************************************************************************************************/ 
void TIM3_IRQHandler (void) 
{
 static uint8_t  TIM3CH1_CATURE_STA = 0; 						// 输入捕获状态	
 if (TIM_GetITStatus (TIM3,TIM_IT_CC1) == SET) 					// 捕获 1 发生捕获事件
	{
	 if ((TIM3CH1_CATURE_STA & 0x40) == 0x40)					//【捕获到一个下降沿】
		{
		 TW_reg[iii] = TIM_GetCapture1 (TIM3);					// 读取定时器3通道1 捕获值
         iii++;
         iii &= 0x7f;

         syc_check_flag = 1;									//捕捉到下降沿标志 = 1

		 TIM_SetCounter (TIM3,0);								// 将定时器 3（TIM3）的计数器值强制设置为 0			
		 TIM3CH1_CATURE_STA = 0x00;								// [标记 要捕获上升沿]
		 TIM_OC1PolarityConfig (TIM3,TIM_OCPolarity_High); 		// [设置为上升沿捕获]
		}
	 else														//【捕获到一个上升沿】
	    {					
		 TIM_SetCounter (TIM3,0);								// 将定时器 3（TIM3）的计数器值强制设置为 0
         TIM3CH1_CATURE_STA = 0x40;								// [标记 要捕获下降沿]
		 TIM_OC1PolarityConfig (TIM3,TIM_OCPolarity_Low); 		// [设置为下降沿捕获]
		}
	}
 TIM_ClearITPendingBit (TIM3,TIM_IT_Update|TIM_IT_CC1); 		// 清除中断标志位
}

/******************************************************************************************************/
uint8_t head(uint8_t n,uint8_t type0)
{
 uint8_t z= 0;
 if (type0 == 0)					//type = 0
    {
	 if((TW_reg[n] > (750-50)) && (TW_reg[n] < (1050+50)))
	   {z = 1;}
	 else if ((TW_reg[n] > (1700-50)) && (TW_reg[n] < (2400+50)))
	   {z = 2;}		 
	}
 else								//type = 1
    {if((TW_reg[n] > (3900-50)) && (TW_reg[n] < (5100+50))) 
	   {z = 3;}
	}	 
 return(z);
}

 uint16_t rx_reg[48];	

uint8_t cc_bit(uint8_t n)
{uint8_t z= 0;
	 if((rx_reg[n] > (750-50)) && (rx_reg[n] < (1050+50)))
	   {z = 0;}
	 else if ((rx_reg[n] > (1700-50)) && (rx_reg[n] < (2600+50)))
	   {z = 1;}		 
return z;	
}
/*******************************************************************************************************
                                            检测  RF433信号

*******************************************************************************************************/
void Check_RF_Code(void)									
{
 static uint8_t tmp_key = 0;
 static uint8_t i,m;
 static uint8_t key[6] = {0,0,0,0,0,0};
 if (syc_check_flag == 1)										//捕捉到下降沿标志 = 1
    {syc_check_flag = 0;										//清 下降沿标志

	 for (i=0; i<230; i++)										//检测 6位前导码 + 起始位宽 5.00mS ?	
		 {if ((head(i+0,0)==1)&&(head(i+1,0)==1)&&(head(i+2,0)==1)&&(head(i+3,0)==1)&&(head(i+4,0)==1)&&(head(i+5,0)==1)&&(head(i+6,1)==3))											
			 {
			  rec_check_flag = 1;								//数据开始接收标志 = 1	
			  break;					  
			 }		  
		 }
/*----------------------------------------------------------------------------------------------------*/
     if	(rec_check_flag == 1)									//数据开始接收标志 = 1
	    {
		 for (m=0; m<48; m++) 
		     {rx_reg[m] = TW_reg[(i+7+m)&0x7f];}				//转移接收数据

		 for (m=0; m<48; m++)									//移位操作 
			 {
			  key[5] <<= 1;  
              if ((key[4] & 0x80)==0x80) {key[5] |= 0x01;} 				 
				 
			  key[4] <<= 1;  
              if ((key[3] & 0x80)==0x80) {key[4] |= 0x01;} 				 				 
				 
			  key[3] <<= 1;  
              if ((key[2] & 0x80)==0x80) {key[3] |= 0x01;} 				 				 				 
				 
			  key[2] <<= 1;  
              if ((key[1] & 0x80)==0x80) {key[2] |= 0x01;} 				 				 				 
				 
			  key[1] <<= 1;  
              if ((key[0] & 0x80)==0x80) {key[1] |= 0x01;} 				 				 				 				 
				 
			  key[0] <<= 1;  			 	 
			  if (cc_bit(m)==1){key[0] |= 0x01;}
			 }
/*----------------------------------------------------------------------------------------------------*/				 
			 if ((key[5]==0xAA)&&(key[0]==0x55) && (key[2]+key[1] == 0xff))	//校验头尾 信互补验正
			    {															//检出数据！						
				 write_data[0] = key[1];									//eeprom 写入寄存器
				 write_data[1] = key[2];						
				 write_data[2] = key[3];						
				 write_data[3] = key[4];						
					
			     for (m=0;m<48;m++) {rx_reg[m] = 0;}						//清数组
				 for (m=0;m<200;m++){TW_reg[m] = 0;}						//清接收数组
				 rec_check_flag = 0;										//清 数据开始接收标志 已完成接收!
				 
				 //debug UID****************************************************************************
				 # if 0
				 for (m=0; m<6; m++)
				     {USART_SendData(USART2, key[m]);							// 串口2 刷新 鸿蒙模块数据
				      while (USART_GetFlagStatus(USART2, USART_FLAG_TC) == RESET); 	// 等待发送完成			 			 
					 }
				 
				 # endif 
/*++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++*/
				 if (delay_1_Minute)										//在上电的1分钟内
				    {
					 power_num0++;											//上电待机键计数值	
					}
                 else														//在上电的1分钟外
				    {if (tmp_key != key[1])									//剔除重复信号！
				        {tmp_key = key[1];						
                         if ((read_data[2]==write_data[2])&&(read_data[3]==write_data[3]))	//地址码相等
						    {
/*%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%*/
					         if (key[1] == Key_ZaoMin_ON)							//照明 开
								{Stat.ZaoMin = 1;
								 Beeping(1,200,200);  								// 蜂鸣器 短叫1声		
								 Pro_Control(1,Command_Lamp,1,1);					//过程控制	
								}
							 if (key[1] == Key_ZaoMin_OFF)							//照明 关
								{Stat.ZaoMin = 0;
								 Beeping(1,200,200);  								// 蜂鸣器 短叫1声		
								 Pro_Control(1,Command_Lamp,0,1);					//过程控制	
								}					
/*----------------------------------------------------------------------------------------------------*/
							 if (key[1] == Key_HuanQi_ON)							//换气 开
								{Stat.HuanQi = 1;
								 Beeping(1,200,200);  								// 蜂鸣器 短叫1声		
								 Pro_Control(1,Command_HuanQi,1,1);					//过程控制								
								}
							 if (key[1] == Key_HuanQi_OFF)							//换气 关
								{Stat.HuanQi = 0;
								 Beeping(1,200,200);  								// 蜂鸣器 短叫1声		
								 Pro_Control(1,Command_HuanQi,0,1);					//过程控制	
								}	
								
/*###########################################################################################################################*/
/*                                                         弱暖开                                                            */
/*###########################################################################################################################*/
							 if (key[1] == Key_W_Warm_ON)							//弱暖 开   //[3-4] –浴霸风暖开关， 00-关； 01-开弱暖； 10 –开强暖
								{Stat.W_Warm = 1;
								 Stat.S_Warm = 0;
								 warm0 = 1;	
								 cuifen0 = 0;	 							
								 Beeping(1,200,200);  								// 蜂鸣器 短叫1声		
								 Pro_Control(1,Command_Warm,1,1);					//过程控制								
								}
/*%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%*/
/*                                                         弱暖关                                                            */
/*%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%*/
							 if (key[1] == Key_W_Warm_OFF)							//弱暖 关
								{
								 Beeping(1,200,200);  								//蜂鸣器 短叫1声									
									
								 if ((Stat.W_Warm == 0)&&(Stat.S_Warm == 1))		//如果强暖 = 1
								    {
									 warm0 = 2;								
								     cuifen0 = 0;	 														
								     Pro_Control(1,Command_Warm,2,1);				//过程控制																		
									}									
/*---------------------------------------------------------------------------------------------------------------------------*/
								 if ((Stat.W_Warm == 0)&&(Stat.S_Warm == 0))		//强弱暖 关	
								    {
                                     if (Stat.CuiFen == 1)							//吹风 =1	
								        {
								         cuifen0 = 1;	
								         warm0 = 3;	 
								         cushi0 = 0;	 														
								         Pro_Control(1,Command_CuiFen,1,1);			//过程控制																									
									    }
								    }
/*---------------------------------------------------------------------------------------------------------------------------*/
								 if ((Stat.S_Warm == 0)&&(Stat.W_Warm == 1))		//弱暖 开	
									{
								     warm0 = 0;								
								     cuifen0 = 0;	 														
				                     Stat.Sub_CuiFen = 1;							//辅助吹风=1
				                     Warm_Delay_15S = W_delay_Tmr;					//取暖延时=15  
								     Pro_Control(1,Command_Warm,0,1);				//过程控制
									}									 
								}						

								
/*###########################################################################################################################*/
/*                                                         强暖开                                                            */
/*###########################################################################################################################*/								
							 if (key[1] == Key_S_Warm_ON)							//强暖 开
								{Stat.S_Warm = 1;
								 Stat.W_Warm = 0;
								 warm0 = 2;								
								 cuifen0 = 0;	 														
								 Beeping(1,200,200);  								// 蜂鸣器 短叫1声		
								 Pro_Control(1,Command_Warm,2,1);					//过程控制															
								}
/*%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%*/
/*                                                         强暖关                                                            */
/*%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%*/
							 if (key[1] == Key_S_Warm_OFF)							//强暖 关
								{
								 Beeping(1,200,200);  								// 蜂鸣器 短叫1声									
									
								 if ((Stat.W_Warm == 1)&&(Stat.S_Warm == 0))		//如果弱暖 = 1
								    {
									 warm0 = 1;								
								     cuifen0 = 0;	 														
								     Pro_Control(1,Command_Warm,1,1);				//过程控制																		
									}
/*---------------------------------------------------------------------------------------------------------------------------*/
								 if ((Stat.W_Warm == 0)&&(Stat.S_Warm == 0))		//强弱暖 关	
								    {
                                     if (Stat.CuiFen == 1)							//吹风 =1	
								        {
								         cuifen0 = 1;	
								         warm0 = 3;	 
								         cushi0 = 0;	 														
								         Pro_Control(1,Command_CuiFen,1,1);			//过程控制																									
									    }
								    }
/*---------------------------------------------------------------------------------------------------------------------------*/
								 if (Stat.CuShi == 0)
								    {
								     if ((Stat.S_Warm == 1)&&(Stat.W_Warm == 1))	//强弱暖 开	
									    {
								         warm0 = 0;								
								         cuifen0 = 0;	 														
				                         Stat.Sub_CuiFen = 1;						//辅助吹风=1
				                         Warm_Delay_15S = W_delay_Tmr;				//取暖延时=15  
								         Pro_Control(1,Command_Warm,0,1);			//过程控制
									    }									 									
									}									 
								}						

/*###########################################################################################################################*/
							 if (key[1] == Key_CuiFen_ON)							//吹风 开
								{Stat.CuiFen = 1;			//
								 cuifen0 = 1;	
								 warm0 = 3;	 
								 cushi0 = 0;	 														
								 Beeping(1,200,200);  								// 蜂鸣器 短叫1声		
								 Pro_Control(1,Command_CuiFen,1,1);					//过程控制															
								}
/*%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%*/
							 if (key[1] == Key_CuiFen_OFF)							//吹风 关
								{
								 Beeping(1,200,200);  								// 蜂鸣器 短叫1声


								 if (Stat.CuShi == 1)								//除湿 = 1
								    {
									}									 
								 else if ((Stat.S_Warm == 1)&&(Stat.W_Warm == 0))	//强暖 = 1
								    {
								     warm0 = 3;								
								     cuifen0 = 0;	 										
								     Pro_Control(1,Command_Warm,1,1);				//过程控制																									
									} 
								 else if ((Stat.S_Warm == 0)&&(Stat.W_Warm == 1)) 	//弱暖 =1
								    {
								     warm0 = 3;	
								     cuifen0 = 0;	 							
								     Pro_Control(1,Command_Warm,2,1);				//过程控制								
									}									 
								 else												//强弱暖 = 00
								    {Stat.CuiFen = 0;
								     cuifen0 = 0;	
								     warm0 = 3;	 
								     cushi0 = 0;	 														
								     Pro_Control(1,Command_CuiFen,0,1);				//过程控制																		
									}									 
								}
								
/*###########################################################################################################################*/
							 if (key[1] == Key_CuShi_ON)							//除湿 开
								{
								 cushi0 = 1;
								 cuifen0 = 0;
								 warm0 = 0;	 							
								 Beeping(1,200,200);  								// 蜂鸣器 短叫1声		
								 Pro_Control(1,Command_CuShi,1,1);					//过程控制															
								}
						
/*%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%*/
							 if (key[1] == Key_CuShi_OFF)							//除湿 关
								{
								 if (Stat.CuShi == 1)
								    {
								     cushi0 = 0;						
								     cuifen0 = 0;
								     warm0 = 0;	 							
								     //Beeping(1,200,200);  						// 蜂鸣器 短叫1声											
								     Pro_Control(1,Command_CuShi,0,1);				//过程控制																									
									} 
                                  else
								    {
								     Pro_Control(1,Command_CuShi,2,1);				//过程控制	单独处理																								
									}
								}
								
								
/*====================================================================================================*/
							 if (key[1] == Key_BaiYi_ON)							//摆风 开
								{
								 Beeping(1,200,200);  								// 蜂鸣器 短叫1声		
								 Pro_Control(1,Command_BaiYei,1,1);					//过程控制															
								}
/*----------------------------------------------------------------------------------------------------*/												
							 if (key[1] == Key_BaiYi_OFF)							//摆风 关
								{
								 Beeping(1,200,200);  								// 蜂鸣器 短叫1声		
								 Pro_Control(1,Command_BaiYei,0,1);					//过程控制															
								}					
/*====================================================================================================*/
							 if (key[1] == Key_Power)								//待机
								{
								 cuifen0 = 0;
								 warm0 = 0;	
								 cushi0 = 0; 	
								 Stat.HuanQi = 0; 
								 Beeping(1,200,200);  								// 蜂鸣器 短叫1声		
								 Pro_Control(1,Command_Power,0,1);					//过程控制																						
								}
/*====================================================================================================*/
							 if (key[1] == Key_Rst_WiFi)							//重置配网
								{
								 Rst_Net = 0x0A;									//重置配网 值 0x0A
								 Net_delay = 120;									//配网1分种计时					   

								 Stat.HuanQi = 0;
								 Stat.CuiFen = 0;
								 Stat.W_Warm = 0;
								 Stat.S_Warm = 0;
								 Stat.BaiYei = 0;
								 Stat.CuShi  = 0;							 
                                 Stat.ZaoMin = 0;									//关闭照明								
									
								 Ble_Stat &= ~0x40;									//除湿 关					 
								 Ble_Stat &= ~0x20;									//摆风 关	 
								 Ble_Stat &= ~0x18;									//风暖 关
								 Ble_Stat &= ~0x04;									//吹风 关
								 Ble_Stat &= ~0x02;            						//换气 关					 
								 Ble_Stat &= ~0x01;									//照明 关
									
								 Stat.CuiFen = 0;									//关闭吹风		 
								 dj_d_status = 0;									//-[关闭摆页]-
								 Stat.BaiYei = 0;									//关摆叶   
								 dj_sw_en = 1;  									//摆叶切换状态使能 = 1  
									
								 Net_Suess_F = 0;									//鸿蒙配网成功标志 （预期：添加设备应默认远程禁用）
								 
								 delay_1_Minute = 0;								//上电1分钟配网延时
								 En_Net_Flag = 0;									//联网使能 默认远程控制关闭								 
								 Uart_Tx(2,Command_Rst_Net,Rst_Net,Ble_Stat,0);		//[串口返回]
								 send_Net_Setup_flag = 1;							//发送重置配网标志
								 Beeping(2,200,200);  								// 蜂鸣器 短叫2声	
								}		
						
/*====================================================================================================*/
							 if (key[1] == Key_WiFi_En)								//联网使能
								{
								 if (En_Net_Flag == 1)	
									{En_Net_Flag = 0;
									 Status1 &= ~0x02;				  				//status1 bit1 = 0;	
									}
								 else
									{En_Net_Flag = 1;
									 Status1 |= 0x02;								//status1 bit1 = 1;	
									}							 
									
								 Stat.HuanQi = 0;
								 Stat.CuiFen = 0;
								 Stat.W_Warm = 0;
								 Stat.S_Warm = 0;
								 Stat.BaiYei = 0;
								 Stat.CuShi  = 0;							 
									
								 Ble_Stat &= ~0x40;									//除湿 关					 
								 Ble_Stat &= ~0x20;									//摆风 关	 
								 Ble_Stat &= ~0x18;									//风暖 关
								 Ble_Stat &= ~0x04;									//吹风 关
								 Ble_Stat &= ~0x02;            						//换气 关					 

								 Stat.CuiFen = 0;									//关闭吹风		 
								 dj_d_status = 0;									//-[关闭摆页]-
								 Stat.BaiYei = 0;									//关摆叶   
								 dj_sw_en = 1;  									//摆叶切换状态使能 = 1  
									
								 Uart_Tx(1,Command_En_Net,En_Net_Flag,Ble_Stat,Status1);		//[串口返回]		 							
								 //Beeping(2,200,200);  								// 蜂鸣器 短叫2声 debug	
								}	
							} 
					    } 
					}
/*----------------------------------------------------------------------------------------------------*/					
				 for (m=0; m<6; m++){key[m]=0;}							//清除RF键值 数组  															 	
			    } 
		}		 
    }	
}

/******************************************************************************************************/
