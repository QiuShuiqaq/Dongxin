
#include "stm32f10x.h"
#include "Hal.H"
#include "STEPPER.H"
#include <stdio.h>

/* ------------------------------------ Flash配置参数 ------------------------------------------------*/
extern uint8_t eprom_f;			   
uint16_t write_data[4] = {0x0000, 0x0000, 0x0000, 0x0000};  // 待写入数据
uint16_t read_data[4]  = {0x0000, 0x0000, 0x0000, 0x0000};  // 读取缓冲区
uint8_t  erase_res;	

/******************************************************************************************************/
uint8_t delay_1_Minute = 60;				//上电1分钟配网延时
extern uint16_t adc_value;					//ADC模拟量
extern uint8_t disp_reg;					//数码管显存

extern uint8_t  Beep_Count;					// 鸣叫次数 
extern uint16_t Beep_Tmr;					// 鸣叫时长 短叫，持续时间 100ms 长叫，持续时间 500ms
extern uint16_t Beep_Interval;				// 鸣叫间隔 时长 200mS
extern uint8_t  Beep_Count0;				// 运行内存          
extern uint16_t beep_tmr0;					// 运行内存        
extern uint16_t beep_interval0;				// 运行内存        
extern uint8_t Warm_Delay_15S;				//取暖延时			   

extern uint8_t Status1;			   
extern uint8_t En_Net_Flag;					//联网使能
extern uint8_t Ble_Stat;					//BLE状态位			   

extern uint8_t power_num0;					//上电待机键计数值

extern void Uart_Tx(unsigned char uart,unsigned char com0,unsigned char sw0,unsigned char stat0,unsigned char stat1);
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
/******************************************************************************************************/
void test_Flash(uint8_t j)			   
{
 if ((j == 1)||(eprom_f == 1))
    {eprom_f = 0;
	 if (eprom_f == 1) {write_data[0]++;}		 
     erase_res = Flash_EraseSector(USER_FLASH_START); 		// 擦除用户区所在扇区
     if (erase_res == 0) 									// 擦除成功
        {} 
     else if (erase_res == 1)    							// Flash忙碌，擦除失败
        {while (1);} 
     else         											// 扇区擦除失败
        {while (1);}

     STMFLASH_Write(USER_FLASH_START, write_data, 4);		// 写入4个半字数据（共8字节）
     STMFLASH_Read(USER_FLASH_START, read_data, 4);    		// 读取数据
	 //Test_Write(USER_FLASH_START + 8, 0x9ABC);			// 单数据写入测试 --地址+8，数据0x9ABC
	}
}	

/*******************************************************************************************************
                                           判断待机键按下次数   
*******************************************************************************************************/   
void Check_Power_Key_Num(void)
{static uint8_t flag = 0;
 if (flag == 0)	
    {
	 if (power_num0 > 8)
		{
		 flag = 1;	
         erase_res = Flash_EraseSector(USER_FLASH_START); 		// 擦除用户区所在扇区
         if (erase_res == 0) 									// 擦除成功
            {} 
         else if (erase_res == 1)    							// Flash忙碌，擦除失败
            {while (1);} 
         else         											// 扇区擦除失败
            {while (1);}
/*----------------------------------------------------------------------------------------------------*/			
         STMFLASH_Write(USER_FLASH_START, write_data, 4);		// 写入地址码（共8字节）
		 Beeping(1,1500,200);  									// 蜂鸣器 长叫1声 1.5秒		 				
		} 	
	} 
}
/*******************************************************************************************************
                                                 main()
												 
*******************************************************************************************************/   
int main(void)
{
 RCC_DeInit();										// 系统时钟		
 NVIC_PriorityGroupConfig (NVIC_PriorityGroup_2); 	// 设置 NVIC 中断分组 2:2 位抢占优先级，2 位响应优先级	
 GPIO_Init0();										// 端口 初始化	
 Setp_Moto_Pin_Init();								//步进电机端口初始化		
	
 Tim2_Init();										// TIM2 初始化 100uS	
 TIM3_Cap_Init();									// TIM3 PA6 捕捉初始化
 TIM4_PWM_Init();									// TIM4 PB9 PWM 初始化	
 Usart1_Init(115200);								// 串口1 (蓝牙) 初始化	
 Usart2_Init(115200);								// 串口2 (鸿蒙) 初始化	
 Usart3_Init(9600);									// 串口3 (RS485)初始化	
 ADC1_Init();										// ADC1 初始化	
 init_Status();										// 系统参数初始化
 IWDG_Init();										// 看门狗初始化
 test_Flash(0);										// 测试Flash
/*----------------------------------------------------------------------------------------------------*/
 Beeping(3,200,200);  								// 蜂鸣器 短叫三声		 	
	
 while (delay_1_Minute)								// 上电 1分钟配网 处理  
       {IWDG_ReloadCounter();						// 喂狗 写 0xAAAA -> KR 
		Check_RF_Code();							// 检测  RF433信号      
		Check_BLE_Uart1();							// BLE   串口数据检测 	   
		Check_Homen_Uart2();						// 鸿蒙  串口数据检测			   
		Check_CI1302_Uart3();					// 配网阶段仍处理离线词
		disp_reg = Conver_Temper();   				// 温度 --> 数码管显存
		TM1620_Display();							// 显示扫描   
		Send_Attch_Net();							// 配网查询    		   
		Check_Power_Key_Num();						// 判断待机键按下次数   
	   }
 STMFLASH_Read(USER_FLASH_START, read_data, 4);    	// 读取数据(地址码)				   
	   
/*----------------------------------------------------------------------------------------------------*/	   
 while (1)
       {
 //dj_d_status = 2; 										// 步进电机状态控制 摆叶固定						 
 //dj_sw_en = 1;			   
		IWDG_ReloadCounter();								// 喂狗 写 0xAAAA -> KR   
		Check_RF_Code();									// 检测  RF433信号   
		Check_BLE_Uart1();									// BLE   串口数据检测 	
		Check_Homen_Uart2();								// 鸿蒙  串口数据检测	
		Check_CI1302_Uart3();							// CI1302 串口数据检测
        Running_Step_Moto();								// 步进电机 
		Sys_Running();										// 系统端口处理	    
		CuShi_TMR_Pro();									// 除湿运行时间   
		Sys_Time_Count();									// 机器关机计时			   	    
		TM1620_Display();									// 显示扫描
		Send_Attch_Net();									// 配网查询    
		Hm_Delay();											// 鸿蒙运行时间倒计时   
       }
}


// https://www.bilibili.com/video/BV1Vo4y1m7ct?spm_id_from=333.788.videopod.episodes&vd_source=c92e2f1f30798c5582454cfc6a52438d&p=27



