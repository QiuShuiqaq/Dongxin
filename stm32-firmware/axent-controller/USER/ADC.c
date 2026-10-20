#include "stm32f10x.h"
#include "Hal.H"
#include "STEPPER.H"

/******************************************************************************************************/
const uint8_t Temper_Table[] = {193,191,188,186,183,181,178,175,173,170,	//01--10
	                            167,164,162,159,156,153,150,147,145,142,	//11--20
	                            139,136,133,130,128,125,122,119,116,114,	//21--30
	                            111,108,106,103,101, 98, 96, 93, 91, 89,	//31--40
	                             86, 84, 82, 79, 77, 75, 73, 71, 69, 67,	//41--50
	                             65, 62, 60, 58, 57, 55, 54, 52, 50, 49,	//51--60
	                             47, 46, 44, 43, 41, 40, 39, 37, 36, 34,	//61--70
	                             33, 31, 30, 29, 28, 27, 26, 25, 24, 23, 	//71--80
	                             22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 	//81--89	
	                             12, 11, 10,  9,  8,  7,  6,  5,  4,  3 	//91--99		
                               };

/******************************************************************************************************/
								  
uint16_t adc_value = 0;					//ADC模拟量								  
uint8_t WenDu_Flag = 0;	

/*******************************************************************************************************
//                                     ADC1单通道初始化（PA1）
*******************************************************************************************************/   
void ADC1_Init(void)
{
 GPIO_InitTypeDef 	GPIO_InitStructure;
 ADC_InitTypeDef 	ADC_InitStructure;

 // 1. 使能GPIOA和ADC1时钟
 RCC_APB2PeriphClockCmd(RCC_APB2Periph_GPIOA | RCC_APB2Periph_ADC1, ENABLE);

 // 2. 配置PA1为模拟输入模式
 GPIO_InitStructure.GPIO_Pin = GPIO_Pin_1;
 GPIO_InitStructure.GPIO_Mode = GPIO_Mode_AIN;      						// 模拟输入模式
 GPIO_Init(GPIOA, &GPIO_InitStructure);

 // 3. 配置ADC参数
 ADC_InitStructure.ADC_Mode 				= ADC_Mode_Independent; 		// 独立模式
 ADC_InitStructure.ADC_ScanConvMode 		= DISABLE;      				// 单通道禁用扫描
 ADC_InitStructure.ADC_ContinuousConvMode 	= DISABLE; 						// 单次转换模式
 ADC_InitStructure.ADC_ExternalTrigConv 	= ADC_ExternalTrigConv_None; 	// 软件触发
 ADC_InitStructure.ADC_DataAlign 			= ADC_DataAlign_Right; 			// 数据右对齐
 ADC_InitStructure.ADC_NbrOfChannel 		= 1;            				// 转换通道数
 ADC_Init(ADC1, &ADC_InitStructure);
	
 // 4. 配置通道 1（PA1）的采样时间
 ADC_RegularChannelConfig(ADC1, ADC_Channel_1, 1, ADC_SampleTime_55Cycles5); // 55.5 周期采样
 
 // 5. 开启 ADC 并校准
 ADC_Cmd (ADC1, ENABLE); 													// 使能 ADC
 ADC_ResetCalibration (ADC1); 												// 复位校准寄存器
 while (ADC_GetResetCalibrationStatus (ADC1)); 								// 等待复位完成
 ADC_StartCalibration (ADC1); 												// 开始校准
 while (ADC_GetCalibrationStatus (ADC1)); 									// 等待校准完成
}

/*******************************************************************************************************
//                                     单通道 ADC1 读取函数 
*******************************************************************************************************/   
uint16_t ADC_ReadSingleChannel(void)
{
     ADC_SoftwareStartConvCmd (ADC1, ENABLE); 									// 启动转换
     while (!ADC_GetFlagStatus (ADC1, ADC_FLAG_EOC)); 							// 等待转换完成
     return ADC_GetConversionValue (ADC1); 										// 返回转换结果		
}

/*******************************************************************************************************
//                                          温度 求滑动平均值 计算                                  
*******************************************************************************************************/   
uint8_t adv_adc(void)
{
 static uint8_t temp[16];
 static uint8_t max = 0;						//最大值
 static uint8_t min = 0xff;						//最小值	
 uint16_t sum = 0;	
 uint8_t i;	
 	
 for (i=0; i<(16-1); i++)						//adc -> 移入数组
	 {temp[i] = temp[i+1];}						//[0]<-[1] [1]<-[2]  [2]<-3] ...[14]<-[15]
 temp[15] = (char)(adc_value >> 4);				//[15]<-[adc]
	
 for (i=0; i<16; i++)							
	 {sum += temp[i];							//计算数据和
	  if (temp[i] >= max){max = temp[i];} 		//找最大值
	  if (temp[i] <= min){min = temp[i];} 	 	//找最小值
	 }
 sum -= max;									//减最大值
 sum -= min;	 								//减最小值
 i = (char)(sum/14);	
 return i;	
}

/*******************************************************************************************************
//                                             温度查表                                  
*******************************************************************************************************/   
uint8_t Conver_Temper(void)
{
 uint8_t low = 0;
 uint8_t high = sizeof(Temper_Table)/sizeof(Temper_Table[0]) - 1;
 uint8_t mid=0;
 uint8_t i=0;
 uint8_t tempvalue;	
	
 if (WenDu_Flag == 1)
    {WenDu_Flag = 0;
	 adc_value = ADC_ReadSingleChannel();		// 读取ADC1 电压值	0x0fff (4095)	     
	} 
 
 //tempvalue = adv_adc();					// 滑动平均值处理
 tempvalue = (char)(adc_value >> 4);	
 if (tempvalue >= Temper_Table[low])
	{
	 return low;
	}
 if (tempvalue <= Temper_Table[high])
	{
	 return high;
	}
 while (low <= high)
	   {
		mid = (low + high) / 2;
		if (Temper_Table[mid] > tempvalue)
		   {
			low = mid +1;
		   }
		else if (tempvalue >= Temper_Table[mid-1])
		   {
			high = mid - 1;
		   }
		else if((Temper_Table[mid-1] > tempvalue )&&(tempvalue >= Temper_Table[mid]))
		   { 
			return mid;
		   }
		//防止while一直执行 一般7次内查询完毕
		if(i++ > 100) return 0;
	   }
 return 0;	
}

/******************************************************************************************************/   





