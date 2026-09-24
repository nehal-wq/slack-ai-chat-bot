import { useEffect,useState } from "react";
function useFetch(url){
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    useEffect(()=>{
        fetch(url)
        .then(response=>{
            if(!response.ok){
                throw new error("something went wrong")
            }
            return response.json
        })
        .then(data=>{
            setData(data)
            setLoading(false)
        })
        .catch(error=>{
            setError(error.message)
            setLoading(false)
        })
    },[url])
    return{
        data,
        loading,
        error
    }
}
export default useFetch