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
str0 Stat;
			   
/******************************************************************************************************/
uint8_t RX2_Data;


volatile uint8_t Res1[32];						//串口1缓存
volatile uint8_t rec1_n = 0;						//串口1计数
volatile uint8_t rec1_F = 0;						//串口1 接收完成标志

volatile uint8_t Res2[32];						//串口2缓存
volatile uint8_t rec2_n = 0;						//串口2计数
volatile uint8_t rec2_F = 0;						//串口2 接收完成标志
			   
			   
uint8_t Net_Suess_F = 0;						//鸿蒙配网成功标志
extern volatile uint8_t dx_control_revision;

/* CI1302 UART1 sends A5 FA 00 81 <semantic low> 00 <sum> FB.
 * The interrupt queues validated semantic IDs; load control stays in main. */
#define CI_QUEUE_SIZE 8U
static volatile uint8_t ci_frame[8];
static volatile uint8_t ci_frame_length = 0U;
static volatile uint8_t ci_queue[CI_QUEUE_SIZE];
static volatile uint8_t ci_queue_head = 0U;
static volatile uint8_t ci_queue_tail = 0U;
static uint8_t ci_event_sequence = 0U;

/* IDs are fixed by the flashed V0.4 resource package. Heating and unverified
 * functions remain blocked until the sample's safety behavior is checked. */
static uint8_t CI1302_Semantic_Allowed(uint8_t semantic_id)
{
 switch (semantic_id) {
  case 1U:  /* wake */
  case 2U:  /* light on */
  case 3U:  /* light off */
  case 8U:  /* ventilation on */
  case 9U:  /* ventilation off */
  case 10U: /* fan on */
  case 11U: /* fan off */
   return 1U;
  default:
   return 0U;
 }
}

static void CI1302_Receive_Byte(uint8_t byte)
{
 uint8_t sum = 0U;
 uint8_t index;
 uint8_t next;
 if (ci_frame_length == 0U) {
  if (byte == 0xA5U) { ci_frame[0] = byte; ci_frame_length = 1U; }
  return;
 }
 if (ci_frame_length == 1U && byte != 0xFAU) {
  ci_frame_length = 0U;
  if (byte == 0xA5U) { ci_frame[0] = byte; ci_frame_length = 1U; }
  return;
 }
 ci_frame[ci_frame_length++] = byte;
 if (ci_frame_length < 8U) { return; }
 ci_frame_length = 0U;
 for (index = 0U; index < 6U; index++) { sum = (uint8_t)(sum + ci_frame[index]); }
 if (ci_frame[2] != 0x00U || ci_frame[3] != 0x81U ||
     ci_frame[5] != 0x00U || ci_frame[6] != sum || ci_frame[7] != 0xFBU ||
     CI1302_Semantic_Allowed(ci_frame[4]) == 0U) { return; }
 next = (uint8_t)((ci_queue_head + 1U) & (CI_QUEUE_SIZE - 1U));
 if (next != ci_queue_tail) {
  ci_queue[ci_queue_head] = ci_frame[4];
  ci_queue_head = next;
 }
}

void Check_CI1302_Uart3(void)
{
 uint8_t semantic_id;
 uint8_t processed = 0U;
 while (ci_queue_tail != ci_queue_head && processed++ < 7U) {
  semantic_id = ci_queue[ci_queue_tail];
  ci_queue_tail = (uint8_t)((ci_queue_tail + 1U) & (CI_QUEUE_SIZE - 1U));
  ci_event_sequence++;
  if (semantic_id == 1U) {
   /* CI already speaks "I am here". C3 must not speak it a second time. */
   Uart_Tx_CI_Event(1U, semantic_id, ci_event_sequence);
  } else {
   switch (semantic_id) {
    case 2U: Pro_Control(1, Command_Lamp, 1, 0); break;
    case 3U: Pro_Control(1, Command_Lamp, 0, 0); break;
    case 8U: Pro_Control(1, Command_HuanQi, 1, 0); break;
    case 9U: Pro_Control(1, Command_HuanQi, 0, 0); break;
    case 10U: Pro_Control(1, Command_CuiFen, 1, 0); break;
    case 11U: Pro_Control(1, Command_CuiFen, 0, 0); break;
    default: continue;
   }
   Uart_Tx_CI_Event(2U, semantic_id, ci_event_sequence);
  }
 }
}
extern uint8_t Net_delay;						//配网1分种计时			
extern uint8_t Rst_Net;							//重置 WIFI， 进入配网模式 0x0A
extern uint8_t delay_1_Minute;					//上电 1分钟配网延时
extern uint8_t send_Net_Setup_flag;				//发送重置配网标志
/*******************************************************************************************************
                                            

*******************************************************************************************************/ 






/*******************************************************************************************************
                                            BLE 串口数据检测

*******************************************************************************************************/ 
void Check_BLE_Uart1(void)							
{
 uint8_t n,m,sum,SW,Command,i,Bpcount;
 uint8_t reg[32];	
 uint8_t reg0[32];

 if (rec1_F == 1)												//串口1 接收完成标志 = 1?
    {rec1_F = 0;
/*----------------------------------------------------------------------------------------------------*/
	 for (n=0; n<32; n++) 										//转移数组 
		 {reg[n] = Res1[n];}				
		 
	 for (n=0; n<32; n++) 										//查找头 [02] [CF] 找到头 记录n 退出循环
		 {if ((reg[n]==RX_Head_H) && (reg[(n+1)&0x1f]==RX_Head_L))
			 {break;
			 }  
		 }
/*----------------------------------------------------------------------------------------------------*/
	 for (m=0; m<32; m++)		 								//整理 02 CF ** ** ** ** ** ** <完整>	
		 {
		  reg0[m] = reg[(n&0x1f)];
		  n++;
		 }
	 sum = 0;													//检查--头[02CF]/[类型]/尾[0F04] 
	 if ((reg0[0]==RX_Head_H)&&(reg0[1]==RX_Head_L)&&(reg0[2]==Type)&&(reg0[30]==RX_End_H)&&(reg0[31]==RX_End_L))
		{
		 for (m=2; m<29; m++)									//数据校验	
			 {
			  sum ^= reg0[m];		 							//异或和
			 }
		 if (sum == reg0[29])									//异或和 相等
			{
			 for (i=0; i<32; i++){Res1[i] = 0x00;}				//串口1 接收缓存区清零！！！
/*----------------------------------------------------------------------------------------------------*/
			 Command = reg0[3];									//命令
			 SW = reg0[4];										//开关
			 Bpcount = reg0[5];									//鸣叫次数
/*----------------------------------------------------------------------------------------------------*/
			 /* C3 frames carry expected revision in reserved bytes 13-14.
			  * Legacy panel frames have no extension and remain compatible. */
			 if (reg0[13] != 0xC2U || reg0[14] == dx_control_revision) {
			  Pro_Control(1,Command,SW,Bpcount);
			 }
			}			 
		}
	}	 			
}

/*******************************************************************************************************
                                             RS485 串口数据检测

*******************************************************************************************************/ 
void Check_Homen_Uart2(void)
{
 uint8_t n,m,sum,SW,Command,i,Bpcount;
 uint8_t reg[32];	
 uint8_t reg0[32];
 uint8_t OL_reg = 0;							//查询模组网络状态  OL： bit0 : 0 –未联网； 1 –已联网
	
 if (rec2_F == 1)										//串口2 接收完成标志 = 1?
    {rec2_F = 0;
/*----------------------------------------------------------------------------------------------------*/
	 for (n=0; n<32; n++) 								//转移数组 
		 {reg[n] = Res2[n];}				
		 
	 for (n=0; n<32; n++) 								//查找头 [02] [CF] 找到头 记录n 退出循环
		 {if ((reg[n]==RX_Head_H) && (reg[(n+1)&0x1f]==RX_Head_L))
			 {break;
			 }  
		 }
/*--------------------------------------------------------------------------------*/
	 for (m=0; m<32; m++)		 						//整理 02 CF ** ** ** ** ** ** <完整>	
		 {
		  reg0[m] = reg[(n&0x1f)];
		  n++;
		 }
	 sum = 0;											//检查--头[02CF]/[类型]/尾[0F04] 
	 if ((reg0[0]==RX_Head_H)&&(reg0[1]==RX_Head_L)&&(reg0[2]==Type)&&(reg0[30]==RX_End_H)&&(reg0[31]==RX_End_L))
		{
		 for (m=2; m<29; m++)							//数据校验	
			 {
			  sum ^= reg0[m];		 					//异或和
			 }
		 if (sum == reg0[29])							//异或和 相等
			{
			 OL_reg = reg0[28];							//查询模组网络状态  OL： bit0 : 0 –未联网； 1 –已联网			 					
			 for (i=0; i<32; i++){Res2[i] = 0x00;}		//串口2 接收缓存区清零！！！
/*--------------------------------------------------------------------------------*/
			 Command = reg0[3];							//命令
			 SW = reg0[4];								//开关
			 Bpcount = reg0[5];							//鸣叫次数						 
			 
/*----------------------------------------------------------------------------------------------------*/
			 switch (Command)
				    {case Command_Net_Stat:						//查询模组网络状态 0xA3
						  if (OL_reg == 1)
						     {Net_Suess_F = 1;					//鸿蒙配网成功标志=1
							  //Beeping(5,200,100);  				//蜂鸣器 	debug	 	 
							  Net_delay = 0;					//配网成功 1分种计时	= 0 
							  Rst_Net= 0;						//配网成功 退出0A	 
							  delay_1_Minute = 0;	 			//上电1分钟配网延时
							  send_Net_Setup_flag = 0;			// 发送重置配网标志	 
							 }
                          else
						     {Net_Suess_F = 0;					//鸿蒙配网成功标志=0
                              Beeping(1,200,200);  				// 蜂鸣器 		 	 								 
							 }							  
                          break;						 							 
					}				 
			 Pro_Control(2,Command,SW,Bpcount);					//过程控制
			}			 
		}
	}	 		
}

/*******************************************************************************************************
                                           串口1 中断接收
										      蓝牙模块
*******************************************************************************************************/ 
void USART1_IRQHandler(void) 
{
 if (USART_GetITStatus(USART1, USART_IT_RXNE) != RESET) 
	{
	 Res1[rec1_n] = USART_ReceiveData(USART1); 						// 接收数据
//	 if (rec1_n >= 1)
//	    {															//检测数据尾
		 if ((Res1[(rec1_n-1)&0x1f]==RX_End_H)&&(Res1[rec1_n]==RX_End_L))
			{
			 rec1_F = 1;											//接收完成标志=1
			}					 
//		}			 
	 rec1_n++;
     rec1_n &= 0x1f;			
   }
}

/*******************************************************************************************************
                                         串口2 中断接收
                                           鸿蒙模块
*******************************************************************************************************/ 
void USART2_IRQHandler(void) 
{
 if (USART_GetITStatus(USART2, USART_IT_RXNE) != RESET) 
	{
	 Res2[rec2_n] = USART_ReceiveData(USART2); 						// 接收数据
//	 if (rec2_n >= 1)
//	    {															//检测数据尾
		 if ((Res2[((rec2_n-1)&0x1f)]==RX_End_H)&&(Res2[rec2_n]==RX_End_L))
			{
			 rec2_F = 1;											//接收完成标志=1
//			}					 
		}			 
	 rec2_n++;
     rec2_n &= 0x1f;							
   }
}

/*******************************************************************************************************
                                         串口3 中断接收
											RS485模块			
*******************************************************************************************************/ 
void USART3_IRQHandler(void)
{
 if (USART_GetITStatus(USART3, USART_IT_RXNE) != RESET) {
  CI1302_Receive_Byte((uint8_t)USART_ReceiveData(USART3));
 }
}
/******************************************************************************************************/

//MODE COM3 9600,0,8,1
//ASSIGN COM3 <S3IN> S3OUT
//ASSIGN COM3 <S2IN> S2OUT
//ASSIGN COM3 <S1IN> S1OUT
