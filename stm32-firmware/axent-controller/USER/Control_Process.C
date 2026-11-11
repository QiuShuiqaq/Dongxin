#include "stm32f10x.h"
#include "Hal.H"
#include "STEPPER.H"


/******************************************************************************/
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
			   
/******************************************************************************/
uint8_t Rst_Net = 0;				//重置 WIFI， 进入配网模式 0x0A
uint8_t En_Net_Flag = 0;			//联网使能 默认远程控制关闭
			   
uint8_t Ble_Stat = 0;				//BLE状态位
uint8_t Status1 = 0;			   
uint8_t Warm_Delay_15S = 0;			//取暖延时			   
volatile uint8_t Work_Time = 0;	//工作时间（定时） 2小时		   
volatile uint8_t work_time0 = 0x78;	//工作时间（定时） 2小时		   
			   
uint8_t CuShi_TMR = 0;				//除湿时间t1 t2
uint8_t CuShi_Count = 0;			//除湿循环次数			   
uint8_t Tmr_1Min;					//1分钟 寄存器
uint8_t CuShi_TMR_Flag;				//除湿定时时标			   
uint8_t Signal_Stat;				//指示灯控制命令
uint8_t Beep_Stat;					//蜂鸣器控制命令			   
uint8_t rx_Beep_Count;				//鸣叫次数			   
volatile uint8_t Work_TMR_Flag;				//工作（1分钟标志）			   

uint8_t sub_delay30S;				//吹风关闭后延时(散热)
uint8_t send_Net_Setup_flag = 0;	//发送重置配网标志
extern uint8_t Net_delay;			//配网1分种计时					   
extern uint8_t Net_Send_F;			//发送查询时间标志位	
extern uint8_t Net_Suess_F;			//鸿蒙配网成功标志
extern uint8_t delay_1_Minute;		//上电 1分钟配网延时
extern uint8_t WenDu;				//温度						   

uint8_t cuifen0;					//【吹风状态】 防重入
uint8_t warm0;						//【暖风状态】 防重入
uint8_t huanqi0;					//【换气状态】 防重入
uint8_t cushi0 = 0;					//【除湿状态】 防重入

extern uint8_t Seek_2_tmr_F;
static uint8_t ci_emit_type = 0U;
static uint8_t ci_emit_semantic = 0U;
static uint8_t ci_emit_sequence = 0U;
volatile uint8_t dx_control_revision = 0U;
/******************************************************************************************************
	                                         串口数据 返回  						 

******************************************************************************************************/
void Uart_Tx(unsigned char uart,unsigned char com0,unsigned char sw0,unsigned char stat0,unsigned char stat1)
{
 uint8_t i;
 uint8_t Tx_Reg[32];									//串口2 发送缓存 	

/*****************************************************************************************************/
/*****************************************************************************************************/
 for (i=0; i<32; i++){Tx_Reg[i] = 0x00;}				//清发送缓存
 
 Tx_Reg[0]  =	TX_Head_H;								//头H 0x02
 Tx_Reg[1]  =	TX_Head_L; 								//头L 0xCA

 Tx_Reg[2]  =	Type;  									//产品类型定义
 Tx_Reg[3]  = 	com0;			//[00]					//命令
 Tx_Reg[4]  =   sw0;			//[01]					//数据
 Tx_Reg[5]  =   0;				//[02]
 Tx_Reg[6]  =   0;				//[03]
 Tx_Reg[7]  =   0; 				//[04]

 Tx_Reg[8]  =   WenDu;			//[05]					//【温度】 
 Tx_Reg[9]  =   0x01;			//[06]					//【TYPE】：机型码， 巨合默认为 0x00，其他默认 0x01
 Tx_Reg[10] =   stat0;			//[07]					//【状态】 
 Tx_Reg[11] =   Work_Time;		//[08]					//【运行时间】
 Tx_Reg[12] =   stat1;	        //[09]					//【状态1】 bit0 模式开关  / bit1 联网使能开关  /  bit2 预留
 Tx_Reg[17] = dx_control_revision;
 if (ci_emit_type != 0U) {
  Tx_Reg[13] = 0xC1U;
  Tx_Reg[14] = ci_emit_type;
  Tx_Reg[15] = ci_emit_semantic;
  Tx_Reg[16] = ci_emit_sequence;
 }

 Tx_Reg[30] =	TX_End_H;								//尾H
 Tx_Reg[31] =	TX_End_L;  								//尾L	   

/*****************************************************************************************************/
 Tx_Reg[29] = Type;
 for (i=3; i<29; i++) 
     {Tx_Reg[29] ^= Tx_Reg[i];}
		 
 for (i=0; i<32; i++)		 
	 {
/*---------------------------------------------------------------------------------------------------*/		 
	  if (uart == 1 || uart == 4)									//串口1；4仅发送给C3
		 {
	      USART_SendData(USART1, Tx_Reg[i]);							// 串口1 刷新手机 APP数据
	      while (USART_GetFlagStatus(USART1, USART_FLAG_TC) == RESET); 	// 等待发送完成			 
	      if (uart == 1) {
	       USART_SendData(USART2, Tx_Reg[i]);
	       while (USART_GetFlagStatus(USART2, USART_FLAG_TC) == RESET);
	      }
		 }
/*---------------------------------------------------------------------------------------------------*/		 
	  else if (uart == 2)												// 鸿蒙 模块
		 {
	      USART_SendData(USART1, Tx_Reg[i]);							// 串口1 刷新手机 APP数据
	      while (USART_GetFlagStatus(USART1, USART_FLAG_TC) == RESET); 	// 等待发送完成			 			 
			 
	      USART_SendData(USART2, Tx_Reg[i]);							// 串口2 刷新 鸿蒙模块数据
	      while (USART_GetFlagStatus(USART2, USART_FLAG_TC) == RESET); 	// 等待发送完成			 
		 }
/*---------------------------------------------------------------------------------------------------*/		 
      else																// 仅向 C3 返回状态，不再向 USART3 发送
	     {
	      USART_SendData(USART1, Tx_Reg[i]);							// 串口1 刷新手机 APP数据
	      while (USART_GetFlagStatus(USART1, USART_FLAG_TC) == RESET); 	// 等待发送完成			 
			 
		 }		  
	 }
/*****************************************************************************************************/
}							 

/*****************************************************************************************************/
//                                           清除图标
/*****************************************************************************************************/
void Uart_Tx_CI_Event(uint8_t event_type, uint8_t semantic_id, uint8_t event_sequence)
{
 if (event_type != 1U && event_type != 2U) { return; }
 ci_emit_type = event_type;
 ci_emit_semantic = semantic_id;
 ci_emit_sequence = event_sequence;
 /* uart=4 sends a valid status-shaped frame to the C3 port only. */
 Uart_Tx(4, 0xD0U, event_type, Ble_Stat, Status1);
 ci_emit_type = 0U;
}

void Cler_ICO_Stat(void)		
{
 Ble_Stat &= 0x01;									//【除照明之外，其他全部关闭】
}	
/*****************************************************************************************************/
//                                           照明图标
/*****************************************************************************************************/
void Lamp_ICO_Stat(uint8_t j)
{if (j == 1)
	{Ble_Stat |= 0x01;}								//打开照明 Status	
 else
    {Ble_Stat &=~0x01;}	 							//关闭照明 Status			
}	
/*****************************************************************************************************/
//                                           强暖图标
/*****************************************************************************************************/
void S_Warm_ICO_Stat(uint8_t j)
{if (j == 1)
	{Ble_Stat |= 0x10;}								//打开强暖 Status	
 else
    {Ble_Stat &=~0x10;}	 							//关闭强暖 Status		
}
/*****************************************************************************************************/
//                                           弱暖图标
/*****************************************************************************************************/
void W_Warm_ICO_Stat(uint8_t j)
{if (j == 1)
	{Ble_Stat |= 0x08;}								//打开弱暖 Status		
 else
    {Ble_Stat &=~0x08;}	 							//关闭弱暖 Status		
}
/*****************************************************************************************************/
//                                           吹风图标
/*****************************************************************************************************/
void CuiFen_ICO_Stat(uint8_t j)
{if (j == 1)
	{Ble_Stat |= 0x04;}								//打开吹风 Status		
 else
    {Ble_Stat &=~0x04;}	 							//关闭吹风 Status		
}
/*****************************************************************************************************/
//                                           换气图标
/*****************************************************************************************************/
void HuanQi_ICO_Stat(uint8_t j)
{if (j == 1)
	{Ble_Stat |= 0x02;}								//打开换气 Status		
 else
    {Ble_Stat &=~0x02;}	 							//关闭换气 Status		
}
/*****************************************************************************************************/
//                                           摆页图标
/*****************************************************************************************************/
void BaiYei_ICO_Stat(uint8_t j)
{if (j == 1)
	{Ble_Stat |= 0x20;}								//打开摆叶 Status		
 else
    {Ble_Stat &=~0x20;}	 							//关闭摆叶 Status		
}
/*****************************************************************************************************/
//                                           除湿图标
/*****************************************************************************************************/
void CuShi_ICO_Stat(uint8_t j)
{if (j == 1)
	{Ble_Stat |= 0x40;}								//打开除湿 Status		
 else
    {Ble_Stat &=~0x40;}	 							//关闭除湿 Status		
}
/*****************************************************************************************************/
//                                           载入运行时间
/*****************************************************************************************************/
void ReLoad_RunTime(void)
{
 if ((Stat.S_Warm == 1)||(Stat.W_Warm == 1)||(Stat.CuiFen == 1)||(Stat.HuanQi == 1)||(Stat.CuShi==1))
    {return;
	} 
 else if ((Stat.S_Warm == 0)&&(Stat.W_Warm == 0)&&(Stat.CuiFen == 0)&&(Stat.HuanQi == 0)&&(Stat.CuShi==0))
    {
	 Work_Time	= 0;
	 Tmr_1Min = 0;		
	}
 else	
    {Work_Time	= work_time0;						//重新载入定时值 ！！！	 					 	
	 Tmr_1Min = 0;	
     Work_TMR_Flag = 0;								//工作（1分钟标志）
	}	 
}

/******************************************************************************************************/
//                          	                    过程控制
//0 –浴霸灯光开关， 0-关； 1-开
//1 –浴霸换气开关， 0-关； 1-开
//2 –浴霸吹风开关， 0-关； 1-开
//[3-4] –浴霸风暖开关， 00-关； 01-开弱暖； 10 –开强暖
//5 –浴霸摆风开关， 0-关； 1-开
//6 –浴霸除湿开关， 0-关； 1-开
//7 –预留			
/******************************************************************************************************/ 
void Pro_Control(unsigned char uart,unsigned char Command,unsigned char SW,unsigned char Bpcount)
{
 if (Command != Command_Stat && Command != Command_Net_Stat &&
     Command != Command_Rst_Net && Command != Command_En_Net) {
  dx_control_revision++;
 }
 switch (Command)								//[命令]         00
		{
	     case Command_Power:
			 if ((Stat.S_Warm==1)||(Stat.W_Warm==1)||(Stat.CuShi==1))
			    {
				 Stat.S_Warm = 0;				//关闭强暖
				 Stat.W_Warm = 0;				//关闭弱暖					 
				 Stat.CuShi  = 0;										
				 Stat.HuanQi = 0;
				 Stat.CuiFen = 0;

				 Stat.Sub_CuiFen = 1;			//辅助吹风=1 
				 Warm_Delay_15S = W_delay_Tmr;	//取暖延时=15  					 
                 sub_delay30S = 30;	 			//吹风关闭后延时(散热)					
				 dj_d_status = 5; 				//【固定摆叶】
				 dj_sw_en = 1;  				//摆叶切换状态使能 = 1  					 					 						 
				}			 
			  else
			    {dj_d_status = 0; 				//【关闭摆叶】
				 dj_sw_en = 1;  				//摆叶切换状态使能 = 1  					 					 						 							 
					
				 Stat.HuanQi = 0;
				 Stat.CuiFen = 0;
				 Stat.W_Warm = 0;
				 Stat.S_Warm = 0;
				 Stat.BaiYei = 0;
				 Stat.CuShi  = 0;					
				}				  
              Cler_ICO_Stat();						//清除图标状态
		 
			  Uart_Tx(uart,0,SW,Ble_Stat,Status1);	//[串口返回]		 
		      break;        	

/*====================================================================================================*/
//				                              [状态查询命令]
/*====================================================================================================*/
	     case Command_Stat:								//[状态查询命令]
			  SW = 0;
			  Uart_Tx(uart,Command_Stat,SW,Ble_Stat,Status1);				//[串口返回]
			  break;
				 
/*====================================================================================================*/
//                                             照明				 
/*====================================================================================================*/
		 case Command_Lamp:								//[灯光开关命令] 01

			  if (Stat.ZaoMin != SW)					// 【照明】
				 {Beeping(1,200,200);  					// 蜂鸣器 		 
				 } 
/*----------------------------------------------------------------------------------------------------*/				 
			  Stat.ZaoMin = SW;							//SW： 0x00 –关闭     0x01 –打开
			  
			  if (Stat.ZaoMin == 1)						//[bit0 –浴霸灯光开关]
			     {Lamp_ICO_Stat(1);}					//[status] 打开照明
			  else
				 {Lamp_ICO_Stat(0);}					//[status] 关闭照明

			  ReLoad_RunTime();							//【照明】载入运行时间	 
			  Uart_Tx(uart,Command_Lamp,SW,Ble_Stat,Status1);	//[串口返回]

			  break;
								 
/*====================================================================================================*/
//                                               换气
/*====================================================================================================*/
		 case Command_HuanQi:							//[换气开关命令] 02

			  if (Stat.HuanQi != SW)					//
				 {Beeping(1,200,200);  					// 蜂鸣器 		 
				 } 				 
/*----------------------------------------------------------------------------------------------------*/				 
			  Stat.HuanQi = SW;							//SW： 0x00 –关闭     0x01 –打开
			  ReLoad_RunTime();							//【换气】载入运行时间
				 
			  if (Stat.HuanQi == 1)						//######## 打开换气 #########
				 {huanqi0 = 1;
				  cushi0 = 0;	 

				  HuanQi_ICO_Stat(1);					//[status] 打开换气
					 
                  if (Stat.CuShi == 1)					//++++++++ 除湿 == 1 ++++++++
				     {Stat.CuShi = 0;					//除湿 = 0
		              S_Warm_ICO_Stat(0);				//关闭 强暖Stat
		              W_Warm_ICO_Stat(0);				//关闭 弱暖Stat
		              CuiFen_ICO_Stat(0);				//关闭 吹风Stat
		              BaiYei_ICO_Stat(0);				//关闭 摆页Stat
		              CuShi_ICO_Stat(0);				//关闭 除湿Stat

				      if ((Stat.S_Warm==1)||(Stat.W_Warm==1))
				         {Stat.S_Warm = 0;				//关闭强暖
				          Stat.W_Warm = 0;				//关闭弱暖					 
				          Stat.Sub_CuiFen = 1;			//辅助吹风=1 
				          Warm_Delay_15S = W_delay_Tmr;	//取暖延时=15  					 
				          dj_d_status = 5; 				//【固定摆叶】
				          dj_sw_en = 1;  				//摆叶切换状态使能 = 1  					 					 						 
                         }
					  else								//除湿 在换气时 
					     {dj_d_status = 0; 				//【关闭摆叶】
				          dj_sw_en = 1;  				//摆叶切换状态使能 = 1  					 					 						 							 
						 }						  
					 }
				 }	 
			  else										//######## 关闭换气 #########
				 {huanqi0 = 0;
				  HuanQi_ICO_Stat(0);					//[status] 关闭换气
				 }
			  Uart_Tx(uart,Command_HuanQi,SW,Ble_Stat,Status1);	//[串口返回]
			  break;
								 
/*====================================================================================================*/
//                                                吹风								 
/*====================================================================================================*/
		 case Command_CuiFen:							//[吹风开关命令] 03

			  //if (cuifen0 != SW)						//判断和上次的[吹风状态]==不一样
				 {cuifen0 = SW;							//[吹风状态]-->cuifen0
				  Beeping(1,200,200);  					//蜂鸣器 		 
				  warm0 = 3;	 
				  cushi0 = 0;	 
				 } 
/*----------------------------------------------------------------------------------------------------*/				 
			  Stat.CuiFen = SW;							//SW：0x00 –关闭 0x01 –打开				 
			  ReLoad_RunTime();							//【吹风】 载入运行时间
				 
/*====================================================================================================*/
              if (Stat.CuiFen == 1)						//######## 打开吹风 #########
				 {
				  CuiFen_ICO_Stat(1);					//吹风Stat	 
/*----------------------------------------------------------------------------------------------------*/
				  dj_sw_en = 1; 						//摆叶切换状态使能 = 1
				  if (dj_d_status == 0)
				     {dj_d_status = 5;					//【固定摆叶】
					  BaiYei_ICO_Stat(0);				//摆页Stat					 	 
					 }	 
				  else if (dj_d_status == 2)
				     {
				      BaiYei_ICO_Stat(1);				//摆页Stat					 
					 }					  
/*----------------------------------------------------------------------------------------------------*/
				  if (Stat.CuShi == 1)					//【除湿】？
				     {Stat.CuShi = 0;					//除湿 = 0
					  CuShi_ICO_Stat(0);				//除湿Stat		   						  	 
					  Stat.HuanQi = 0;					//换气=0
					  HuanQi_ICO_Stat(0);				//[status] 关闭换气	 
					 } 
/*----------------------------------------------------------------------------------------------------*/
				  if ((Stat.S_Warm==1)||(Stat.W_Warm==1))
				     {Stat.Sub_CuiFen = 0;				//辅助吹风=0 	 
					  sub_delay30S = 30;	 			//吹风关闭后延时(散热)
					 }
				  else 
				     {Stat.Sub_CuiFen = 0;				//辅助吹风=0 	 
					  Warm_Delay_15S =  0;		 						 
					 }
/*----------------------------------------------------------------------------------------------------*/
				  Stat.S_Warm = 0;						//强暖=0
				  Stat.W_Warm = 0; 						//弱暖=0
				  S_Warm_ICO_Stat(0);					//关闭 强暖Stat
				  W_Warm_ICO_Stat(0);					//关闭 弱暖Stat	 
				 }
/*====================================================================================================*/				 
              else										//######## 关闭吹风 #########
				 {CuiFen_ICO_Stat(0);					//关闭 吹风Stat	 
				  BaiYei_ICO_Stat(0);					//关闭 摆页Stat	 
					 
                  if (sub_delay30S != 0)				//吹风关闭后延时(散热)
				     {
					  dj_sw_en = 1;  					//摆叶切换状态使能 = 1
					  dj_d_status = 1;					//【打开摆叶】	
					  Stat.Sub_CuiFen = 1;				//辅助吹风=1 
					  Warm_Delay_15S = sub_delay30S;	//吹风延时 = 吹风关闭后延时(散热)
					 }
				  else
				     {dj_d_status = 0;					//-[关闭摆页]-
					 Stat.BaiYei = 0;					//关摆叶   
					 }					  
				  	 
				  if ((Stat.CuShi==1)||(Stat.S_Warm==1)||(Stat.W_Warm==1))	//【除湿】【强暖】【弱暖】？	 
				     {
					  dj_sw_en = 1;  					//摆叶切换状态使能 = 1
					  dj_d_status = 1;					//【打开摆叶】	
					  Stat.Sub_CuiFen = 0;				//辅助吹风=1 
					  Warm_Delay_15S = 0;				//吹风延时 = 吹风关闭后延时(散热)
					 }
				 }					  
			  Uart_Tx(uart,Command_CuiFen,SW,Ble_Stat,Status1);	//[串口返回]
			  break;
								 
/*====================================================================================================*/
//							           ####[0x00 –关闭 暖风]####
//		0x00  关闭
//		0x01  打开弱暖
//		0x02  打开强暖
//		0x03  关闭弱暖
//		0x04  关闭强暖
/*====================================================================================================*/
		 case Command_Warm:									//[暖风开关命令] 04

			  //if (warm0 != SW)							//判断和上次的[暖风状态]==不一样
			     {warm0 = SW;                           	//[暖风状态]-->warm0
				  Beeping(1,200,200);  						//蜂鸣器 		 
				  cuifen0 = 0;								//[吹风状态] = 0 
				  cushi0 = 0;	 							//[除湿状态] = 0
				 }
/*----------------------------------------------------------------------------------------------------*/
			  if (SW == 0)									//–浴霸风暖开关， 0x00-关
				 {
                  if ((Stat.S_Warm == 0)&&(Stat.W_Warm == 0)&&(Stat.CuiFen == 0)&&(Stat.HuanQi == 0)&&(Stat.CuShi==0))
				     {
                      Stat.Sub_CuiFen = 0;					//辅助吹风=1
				      Warm_Delay_15S = 0;					//取暖延时=15  
				      sub_delay30S = 0;						////吹风关闭后延时(散热) = 30
					 
				      dj_d_status = 0; 						//【固定摆叶】
				      dj_sw_en = 1;  						//摆叶切换状态使能 = 1 						 
					 }
				  else
				     {Stat.Sub_CuiFen = 1;					//辅助吹风=1
				      Warm_Delay_15S = W_delay_Tmr;			//取暖延时=15  
				      sub_delay30S = W_delay_Tmr;			////吹风关闭后延时(散热) = 30
					 
				      dj_d_status = 5; 						//【固定摆叶】
				      dj_sw_en = 1;  						//摆叶切换状态使能 = 1 						 
					 }					  
					 
				  warm0 = 0;					 
				  Stat.CuiFen = 0;						//关闭吹风 
				  Stat.S_Warm = 0;						//关闭强暖
				  Stat.W_Warm = 0; 						//关闭弱暖	
				  S_Warm_ICO_Stat(0);					//强暖Stat
				  W_Warm_ICO_Stat(0);					//弱暖Stat
				  CuiFen_ICO_Stat(0);					//吹风Stat					 
				  BaiYei_ICO_Stat(0);					//摆页Stat
				  CuShi_ICO_Stat(0);					//除湿Stat		   					 
				  ReLoad_RunTime();						//【暖风00】载入运行时间
			     }
/*----------------------------------------------------------------------------------------------------*/
//							       ####[0x01 –打开弱暖风]####
/*----------------------------------------------------------------------------------------------------*/
			  else if (SW == 1)							//–浴霸风暖开关， 0x01-开弱暖；
				 {                                      
				  warm0 = 1;	 
				  if (Stat.CuShi == 1)					//除湿 = 1					 
				     {Stat.CuShi = 0;					//除湿关闭
					  Stat.HuanQi = 0;	 				//换气关闭
					  HuanQi_ICO_Stat(0);				//换气Stat						 
				      CuShi_ICO_Stat(0);				//除湿Stat		   					 						 
					 }
				  if (dj_d_status == 2)
				     {BaiYei_ICO_Stat(1);				//摆页Stat
					 }
                  else
				     {BaiYei_ICO_Stat(0);				//摆页Stat
				      dj_d_status = 5; 					//【固定摆叶】						 
					 }					  
				  S_Warm_ICO_Stat(0);					//强暖Stat
				  W_Warm_ICO_Stat(1);					//弱暖Stat
				  CuiFen_ICO_Stat(0);					//吹风Stat					 
					 
				  Stat.S_Warm = 0;						//关闭强暖
				  Stat.W_Warm = 1; 						//打开弱暖
				  Stat.CuiFen = 1;						//打开吹风 									 
				  Stat.Sub_CuiFen = 0;					//辅助吹风=0 
				  Warm_Delay_15S = 0;					//取暖延时=0    
				  dj_sw_en = 1;  						//摆叶切换状态使能 = 1  					 
				  ReLoad_RunTime();						//【暖风01】载入运行时间
				 }
/*----------------------------------------------------------------------------------------------------*/
//							        ####[0x02 –打开强暖风]####
/*----------------------------------------------------------------------------------------------------*/
			  else if (SW == 2)							//–浴霸风暖开关， 0x02 –开强暖 
				 {                                      
				  warm0 = 2;	 
				  if (Stat.CuShi == 1)					//除湿 = 1					 
				     {Stat.CuShi = 0;					//除湿关闭
					  Stat.HuanQi = 0;	 				//换气关闭
					  HuanQi_ICO_Stat(0);				//换气Stat						 
				      CuShi_ICO_Stat(0);				//除湿Stat		   					 						 
					 }
					 
				  if (dj_d_status == 2)
				     {BaiYei_ICO_Stat(1);				//摆页Stat
					 }
                  else
				     {BaiYei_ICO_Stat(0);				//摆页Stat
				      dj_d_status = 5; 					//【固定摆叶】						 
					 }					  					 
					 
				  S_Warm_ICO_Stat(1);					//强暖Stat
				  W_Warm_ICO_Stat(0);					//弱暖Stat
				  CuiFen_ICO_Stat(0);					//吹风Stat					 					 
					 
				  Stat.S_Warm = 1;						//打开强暖
				  Stat.W_Warm = 1;						//打开弱暖	
				  Stat.CuiFen = 1;						//打开吹风 									 
				  Stat.Sub_CuiFen = 0;					//辅助吹风=0 
				  Warm_Delay_15S = 0;					//取暖延时=0    					 
				  dj_sw_en = 1;  						//摆叶切换状态使能 = 1  
					 
				  ReLoad_RunTime();						//【暖风02】载入运行时间
				 }
/*----------------------------------------------------------------------------------------------------*/
//							          ####[0x03 – 关闭 弱暖]####
/*----------------------------------------------------------------------------------------------------*/
			  else if (SW == 3)							//–浴霸风暖开关， 0x03 关闭弱暖
				 {  
				  warm0 = 3;	 
				  if ((Stat.W_Warm==1)&&(Stat.S_Warm==0)&&(Stat.CuShi==0))	//弱暖 == 1
				     {
				      Stat.S_Warm = 0;					//关闭强暖
					  Stat.W_Warm = 0;					//关闭弱暖	

					  Stat.Sub_CuiFen = 1;				//辅助吹风=1
				      Warm_Delay_15S = W_delay_Tmr;		//取暖延时=15  
				      sub_delay30S = W_delay_Tmr;		////吹风关闭后延时(散热) = 30
					 
				      dj_d_status = 5; 					//【固定摆叶】
				      dj_sw_en = 1;  					//摆叶切换状态使能 = 1 								 

					  dj_sw_en = 1;  					//摆叶切换状态使能 = 1  					 
					  ReLoad_RunTime();					//【暖风03】载入运行时间					   
					  
				      S_Warm_ICO_Stat(0);				//强暖Stat
				      W_Warm_ICO_Stat(0);				//弱暖Stat
				      CuiFen_ICO_Stat(0);				//吹风Stat					 					 					 					  
					 }
				  else									//弱暖 == 0
					 {
					 }					  
				 }
/*----------------------------------------------------------------------------------------------------*/
//							          ####[0x04 – 关闭 强暖]####
/*----------------------------------------------------------------------------------------------------*/
			  else if (SW == 4)							//–浴霸风暖开关， 0x04 关闭强暖
				 {  
				  warm0 = 4;	 
				  if ((Stat.S_Warm==1)&&(Stat.CuShi==0))//强暖 == 1
				     {
				      Stat.S_Warm = 0;					//关闭强暖
					  Stat.W_Warm = 0;					//关闭弱暖	

					  Stat.Sub_CuiFen = 1;				//辅助吹风=1
				      Warm_Delay_15S = W_delay_Tmr;		//取暖延时=15  
				      sub_delay30S = W_delay_Tmr;		////吹风关闭后延时(散热) = 30
					 
				      dj_d_status = 5; 					//【固定摆叶】
				      dj_sw_en = 1;  					//摆叶切换状态使能 = 1 								 

					  ReLoad_RunTime();					//【暖风03】载入运行时间					  
					  
				      S_Warm_ICO_Stat(0);				//强暖Stat
				      W_Warm_ICO_Stat(0);				//弱暖Stat
				      CuiFen_ICO_Stat(0);				//吹风Stat					 					 					 					  
					 }
				  else									//强暖 == 0
					 {
					 }					  
				 }
				 
			  Uart_Tx(uart,Command_Warm,SW,Ble_Stat,Status1);	//[串口返回]						 
			  break;
/*====================================================================================================*/
//                                          摆风开关命令
/*====================================================================================================*/
		 case Command_BaiYei:							//[摆风开关命令]  05
			  Beeping(1,200,200);  						// 蜂鸣器 		 
/*----------------------------------------------------------------------------------------------------*/
			  if (SW == 1)								//####[打开摆叶]####
			     {										//[bit5 –浴霸摆风开关， 0-关； 1-开]
				  if (dj_d_status != 2)
					 {dj_d_status = 2;					//【自动摆叶】
					  dj_sw_en = 1; 
					  BaiYei_ICO_Stat(1);				//摆页Stat						 
					 }
				 }
			  else										//####[关闭摆叶]####
				 {
				  BaiYei_ICO_Stat(0);					//摆页Stat						 					 
                  if (dj_d_status == 2)					//之前打开了摆叶
			         {
                      //#if(BY_FIX == 1)
						    dj_d_status = 5; 			//步进电机状态控制 摆叶固定						 
						    dj_sw_en = 1;
                      //#else
						    //dj_d_status = 1; 			//步进电机状态控制
                      //#endif
					 }
				 }
			  Uart_Tx(uart,Command_BaiYei,SW,Ble_Stat,Status1);	//[串口返回]
			  break;
				 
/*====================================================================================================*/
//                                                 除湿								 
/*====================================================================================================*/
		 case Command_CuShi:							//[除湿开关命令]  06
			  Beeping(1,200,200);  						//蜂鸣器
			  cuifen0 = 0;								//[吹风状态] = 0
			  warm0 = 0;
              huanqi0 = 0;
/*----------------------------------------------------------------------------------------------------*/
			  if (SW == 1)								//####### 浴霸除湿开关， 1-开 #######
				 {
				  //if (cushi0 == 0)
				     {
					  cushi0 = 1;
					  Stat.CuShi = 1;					//浴霸–打开
					  CuShi_Count = 8;					//除湿循环次数
					  CuShi_TMR = 0;					//除湿定时器  [==0 立即进入]
					  //Tmr_1Min = 0;					//1分钟寄存器 [==0 消除误差]
					  CuShi_TMR_Flag = 0;				//除湿定时时标 = 0
						 
					  Stat.S_Warm = 1;					//打开强暖
					  Stat.W_Warm = 1;					//打开弱暖
					  Stat.CuiFen = 1;					//打开吹风
					  Stat.Sub_CuiFen = 0;				//辅助吹风=0
					  Warm_Delay_15S = 0;	 
						 
					  CuShi_ICO_Stat(1);				//打开除湿Stat
					  Stat.HuanQi = 0;					//关闭换气
					  HuanQi_ICO_Stat(0);				//关闭换气Stat
					  CuiFen_ICO_Stat(0);				//关闭吹风Stat
					  S_Warm_ICO_Stat(0);				//关闭强暖Stat
					  W_Warm_ICO_Stat(0);				//关闭弱暖Stat
					  BaiYei_ICO_Stat(0);				//关闭摆页Stat
						 
					  dj_d_status = 5; 					//【固定摆叶】
					  dj_sw_en = 1;  					//摆叶切换状态使能 = 1
					 }
				 }
/*----------------------------------------------------------------------------------------------------*/
			  else if (SW == 0)							//###### 浴霸除湿开关， 0-关 #######
				 {
				  //if (cushi0 == 1)						//判断 除湿 上次 状态 ?
				     {
				      cushi0 = 0;
				      Stat.CuShi = 0;					//浴霸–关闭	 
				      CuShi_Count = 0;					//除湿循环次数
				      CuShi_TMR = 0;					//除湿 0 分钟

				      CuShi_ICO_Stat(0);				//关闭除湿Stat
					  HuanQi_ICO_Stat(0);				//关闭换气Stat
					  CuiFen_ICO_Stat(0);				//关闭吹风Stat
					  S_Warm_ICO_Stat(0);				//关闭强暖Stat
					  W_Warm_ICO_Stat(0);				//关闭弱暖Stat
					  BaiYei_ICO_Stat(0);				//关闭摆页Stat

					  if ((Stat.S_Warm==1)||(Stat.W_Warm==1))
						 {
						  Stat.S_Warm = 0;				//关闭强暖
						  Stat.W_Warm = 0;				//关闭弱暖
						  //Stat.CuiFen = 1;			//打开吹风
						  Stat.CuiFen = 0;	  
						  Stat.Sub_CuiFen = 1;			//辅助吹风=1 
						  Warm_Delay_15S = W_delay_Tmr;	//取暖延时=15
						  dj_d_status = 5; 				//【固定摆叶】
						  dj_sw_en = 1;  				//摆叶切换状态使能 = 1
						 }
					  else
						 {Stat.HuanQi = 0;				//关闭换气
						  Stat.CuiFen = 0;				//关闭吹风
						  dj_d_status = 0;				//-[关闭摆页]-
						  dj_sw_en = 1;  				//摆叶切换状态使能 = 1
						 }					  
					 }
				 }	
/*----------------------------------------------------------------------------------------------------*/
															//单独处理 RF433 遥控器
				  else if (SW == 2)							//###### 浴霸除湿开关， 2-关 #######
				     {cushi0 = 0;
					  CuShi_ICO_Stat(0);					//关闭除湿Stat
					  Stat.CuShi = 0;						//浴霸–关闭	 
					  CuShi_Count = 0;						//除湿循环次数
					  CuShi_TMR = 0;						//除湿 0 分钟
					  SW = 0;	 
					 } 
/*----------------------------------------------------------------------------------------------------*/
				 
			  ReLoad_RunTime();								//【除湿】载入运行时间
			  Uart_Tx(uart,Command_CuShi,SW,Ble_Stat,Status1);	//[串口返回]
			  break;
				 
/*====================================================================================================*/
		 case Command_Signal:							//[指示灯控制命令]
			  Beeping(rx_Beep_Count,100,200);  			// 蜂鸣器
			  Uart_Tx(uart,Command_Signal,SW,Ble_Stat,Status1);	//[串口返回]
			  Signal_Stat = SW;							//0x00-关
														//0x01-开
														//0x02-慢闪， 1s 亮 1s 灭
														//0x03-快闪， 100ms 亮 100ms 灭
			  break;
/*====================================================================================================*/
		 case Command_Beep:								//[蜂鸣器控制命令]
			  Uart_Tx(uart,Command_Beep,SW,Ble_Stat,Status1);	//[串口返回]
			  Beep_Stat = SW;           				//0x01 –短叫， 持续时间 100ms
														//0x02 –长叫， 持续时间 500ms
			  rx_Beep_Count = Bpcount;					//TIMES： 鸣叫次数， 
		                                                //每次间隔时间 200ms	
		      if (Beep_Stat == 0x01)
			     {Beeping(rx_Beep_Count,100,200);  		// 蜂鸣器
				 } 
			  else
			     {Beeping(rx_Beep_Count,500,200);  		// 蜂鸣器
				 } 				  
			  break;

/*====================================================================================================*/
		 case Command_Time:								//[下发开关后的工作时间] 
			  Beeping(1,200,200);  						// 蜂鸣器 		 

/*----------------------------------------------------------------------------------------------------*/
			  Tmr_1Min = 0;
		      Work_TMR_Flag = 0;						//工作（1分钟标志）清0

              if ((Stat.S_Warm == 0)&&(Stat.W_Warm == 0)&&(Stat.CuiFen == 0)&&(Stat.HuanQi == 0)&&(Stat.CuShi==0)&&(Stat.ZaoMin==1))
                 {Work_Time	= 0;
	              Tmr_1Min = 0;		
	             }				 
			  else
			     {work_time0 = SW;						//SW:0~120 单位分钟  <--> 工作时间（定时） 存入定时值 ！！！	
			      Work_Time = work_time0;				//临时工作时间				 
				 }				  
				 
			  Uart_Tx(uart,Command_Time,SW,Ble_Stat,Status1);	//[串口返回]				 

			  break;
/*====================================================================================================*/
		 case Command_Rst_Net:							//[重置配网 重置 WIFI， 进入配网模式] 0x0A 

			  Rst_Net = 0x0A;							//重置配网 值 0x0A
			  Net_delay = 120;							//配网1分种计时					   

			  Stat.HuanQi = 0;
			  Stat.CuiFen = 0;
			  Stat.W_Warm = 0;
			  Stat.S_Warm = 0;
			  Stat.BaiYei = 0;
			  Stat.CuShi  = 0;							 
		 
			  Cler_ICO_Stat();							//清除图标状态		   
		 
			  Net_Suess_F = 0;							//鸿蒙配网成功标志	
		      delay_1_Minute = 0;						//上电1分钟配网延时
		      Ble_Stat = 0; 
			  Uart_Tx(2,Command_Rst_Net,Rst_Net,0,Status1);	//[串口返回]		 
			  //Uart_Tx(2,Command_Rst_Net,Rst_Net,Ble_Stat,Status1);	//[串口返回]
			  send_Net_Setup_flag = 1;					//发送重置配网标志

		      break;
/*====================================================================================================*/
		 case Command_Mode_Set:							//[模式设定] 0x0B
			  if (SW == 0x01)							//MODE： 0x01 –进入模式运行状态
			     {Status1 |= 0x01;}						//       0x00 –退出模式运行状态   
			  else										//status1 bit0 = 1;
			     {Status1 &= ~0x01;}					//status1 bit0 = 0;			
				 
			  Uart_Tx(uart,Command_Mode_Set,SW,Ble_Stat,Status1);	//[串口返回]				 
              break;			 
		 
/*====================================================================================================*/
		 case Command_En_Net:							//[联网使能] 0x0C
			  En_Net_Flag = SW;							//浴霸收到该指令联网禁止， 显示板联网指示熄灭， 不响应 APP 指令； 
														//联网使能时， 指示亮起， 响应 APP 指令
		      if (En_Net_Flag == 0x01) 
			     {Status1 |= 0x02;}						//status1 bit1 = 1;
              else
			     {Status1 &= ~0x02;}				  	//status1 bit1 = 0;

              Stat.CuiFen = 0;							//关闭吹风		 
			  dj_d_status = 0;							//-[关闭摆页]-
			  Stat.BaiYei = 0;							//关摆叶   
			  dj_sw_en = 1;  							//摆叶切换状态使能 = 1  				 
				 
			  Uart_Tx(2,Command_En_Net,SW,Ble_Stat,Status1);	//[串口返回]		 
		      break;
		}
}

/*====================================================================================================*/
//                                             配网查询
/*====================================================================================================*/
void Send_Attch_Net(void)
{
 if (Net_Send_F == 1)									//发送查询时间标志位 500mS间隔
    {Net_Send_F = 0;		
	 if (delay_1_Minute != 0)							//【上电1分钟配网延时】	
		{
		 Uart_Tx(2,Command_Net_Stat,0,0,Status1);		//[串口发送] 鸿蒙 查询模组网络状态 0xA3	
		}
	 else												// 不在上电1分钟
		{if (send_Net_Setup_flag == 1)					// 发送重置配网标志
			{
			 if (Net_delay != 0)						// 重新配网1分钟计时
				{
				 Uart_Tx(2,Command_Net_Stat,0,0,Status1);	//[串口发送] 鸿蒙 查询模组网络状态 0xA3		
				}
			}
		}	 
	}
}

/******************************************************************************************************/
//                                        鸿蒙运行时间倒计时
/******************************************************************************************************/
void Hm_Delay(void)
{static uint8_t work0 = 0;	
 if (Work_Time != 0)								//判断 Work_Time <> 0 ?
	{
	 if (Work_Time != work0)						//Work_Time <> work0 【表示Work_Time有更新了】
		{work0 = Work_Time;					

        if ((Stat.S_Warm == 0)&&(Stat.W_Warm == 0)&&(Stat.CuiFen == 0)&&(Stat.HuanQi == 0)&&(Stat.CuShi==0)&&(Stat.ZaoMin==1))
           {//Work_Time = 0xff;
			Work_Time = 0x00;   
	       }				 		   			
		 Uart_Tx(2,Command_Stat,0,Ble_Stat,Status1);//[串口主动上传command_stat 信息]	
		} 
	}		 
}

/******************************************************************************************************/
//                                        机器关机计时
/******************************************************************************************************/
void Sys_Time_Count(void)
{	
if (Work_TMR_Flag == 1)								//工作（1分钟标志）？？
   {Work_TMR_Flag = 0;								//工作（1分钟标志）清0
	   
	if (Work_Time != 1)								//运行时间倒计时 != 0    
	   {Work_Time--;
	   }
	else											//运行时间倒计时 == 0    
	   {Stat.HuanQi = 0;							//关换气
        Stat.CuiFen = 0;							//关吹风
        Stat.CuShi  = 0;							//关除湿		   

		if ((Stat.S_Warm==1)||(Stat.W_Warm==1))		   
		   {
		    Stat.S_Warm = 0;						//关闭强暖
		    Stat.W_Warm = 0;						//关闭弱暖					 
		    Stat.CuiFen = 1;						//打开吹风 									 
		    Stat.Sub_CuiFen = 1;					//辅助吹风=1 
		    Warm_Delay_15S = W_delay_Tmr;			//取暖延时=15  					 
		    dj_d_status = 5; 						//【固定摆叶】
		    dj_sw_en = 1;  							//摆叶切换状态使能 = 1  					 					 						 
		   }
		else
		   {Stat.CuiFen = 0;						//关闭吹风		 
			dj_d_status = 0;						//-[关闭摆页]-
			Stat.BaiYei = 0;						//关摆叶   
			dj_sw_en = 1;  							//摆叶切换状态使能 = 1  															 
		   }	
        Cler_ICO_Stat();							//清除图标状态		   

        Uart_Tx(1,0,0,Ble_Stat,Status1);			//[串口返回] 
	   }		
   }	
}   

