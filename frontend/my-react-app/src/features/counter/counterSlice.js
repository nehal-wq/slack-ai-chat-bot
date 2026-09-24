import {createSlice} from "@reduxjs/toolkit";
const initialState={
    count:0
}
const counterSlice=createSlice({
    name:"counter",
    initialState,

    reducers:{
        increase:(state)=>{
            state.count=state.count+1
        },
        decrease:(state)=>{
            state.count=state.count-1
        },
        reset:(state)=>{
            state.count=0
        }
    }
})
export const {increase,decrease,reset}=counterSlice.actions
export default counterSlice.reducer