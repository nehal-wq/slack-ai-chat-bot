import { useContext } from "react";
import UserContext from "./UserContext";
function User(){
    const user=useContext(UserContext)
    return(
        <div>
            <h3>Name:{user.name}</h3>
            <h3>Age:{user.age}</h3>
            <h3>Dept:{user.dept}</h3>
        </div>
    )
}
export default User