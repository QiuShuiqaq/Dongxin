#ifndef  __STEPPER__H__
#define	 __STEPPER__H__

#include "Hal.H"

//原来的8003程序中  开机复位时 如果是OPEN 且OPEN的第一步是HLLL则 为顺时针

//***********************各个公司摆叶设置*******************//

//这段只需要增加 不用配置
//#if (COMPANY == ZPJ_OSL_F6438_BY_FWD )

#define BYDJ_TYPE  BYDJ_TYPE_N  //顺时针:BYDJ_TYPE_S 和 逆时针:BYDJ_TYPE_N 配置
#define BYXDK   1  							//0：摆叶和吹风同时打开 1：摆叶先打开一定角度后 吹风才能打开
#define BY_SPEED   2  //自动摆叶速度 默认1  单位是5ms
#define BY_FIX  1//摆叶固定：0 摆叶关闭时 恢复到垂直  1：摆叶关闭时 自动固定位置

#define DJ_angle0 200  //初始化角度 复位
#define DJ_angle1 137  //打开角度   默认打开90
#define DJ_angle2 110  //摆叶角度  自动摆叶1的位置
#define DJ_angle3 170  //摆叶角度   自动摆叶2的位置
#define DJ_angle4 0//补偿角度  即复位后回正一定角度  不需要补偿则为0

#define DJ_angle5 137 //换气90度
#define DJ_angle6 170 //小夜灯120度


#define BYDJ2_TYPE  BYDJ2_TYPE_N  //顺时针:BYDJ_TYPE_S 和 逆时针:BYDJ_TYPE_N 配置
#define DJ2_angle0 200  //初始化角度 复位
#define DJ2_angle1 145  //打开角度   默认打开90
#define DJ2_angle2 95  //摆叶角度  自动摆叶1的位置
#define DJ2_angle3 170  //摆叶角度   自动摆叶2的位置
#define DJ2_angle4 0//补偿角度  即复位后回正一定角度  不需要补偿则为0

#define DJ2_angle5 150 //换气90度
#define DJ2_angle6 170 //小夜灯120度

//#endif 
	
//***********************摆叶方向设置*******************//
#define   BYDJ_TYPE_N 0 //逆时针 
#define   BYDJ_TYPE_S 1 //顺时针 

#define   BYDJ2_TYPE_N 0
#define   BYDJ2_TYPE_S 1

//这一段是固定的 不用配置
#if(BYDJ_TYPE == BYDJ_TYPE_S) //顺时针
#define OPEN 0X10  //0--7
#define CLOSE 0X20 
#else
#define OPEN 0X20
#define CLOSE 0X10
#endif

#if(BYDJ2_TYPE == BYDJ2_TYPE_S) //顺时针
#define OPEN2 0X10
#define CLOSE2 0X20
#else
#define OPEN2 0X20
#define CLOSE2 0X10
#endif

#define STOP 0X30
/*****************************************************************************/
//                              电机输入参数结构体
/*****************************************************************************/
typedef  struct
{
	uint8_t  dj_step;								//电机步数
	uint8_t  dj_dir;								//电机方向
	uint8_t  dj_dir_temp;							//方向记录
	int16_t  dj_c_angle;							//电机当前角度
} DJ_st;

extern uint8_t dj_d_status;		//电机最新状态
extern uint8_t dj2_d_status;	//电机最新状态


extern uint8_t dj_sw_en;
extern uint8_t dj_cf_en;											//打开到一定角度才能使能吹风
extern uint8_t dj2_cf_en;										//打开到一定角度才能使能吹风

void DJ1_Function(void);
void DJ2_Function(void);



#endif
